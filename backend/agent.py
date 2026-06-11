"""The agent: plan which connectors to consult → retrieve (tool calls) → ground the
answer in the retrieved docs with citations. Streams typed events so the UI can show
the agent 'thinking' transparently. Works with real Cohere or in mock mode."""
from typing import Iterator

import config
from connectors import CONNECTORS, Doc
from rag import retrieve

# Tool surface the agent can use — one retrieval tool per connector.
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": f"search_{key}",
            "description": f"Search the {meta['label']} for information relevant to the user's question.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "A focused search query."}},
                "required": ["query"],
            },
        },
    }
    for key, meta in CONNECTORS.items()
]
_CONNECTOR_BY_TOOL = {f"search_{k}": k for k in CONNECTORS}


def _heuristic_plan(query: str) -> list[str]:
    q = query.lower()
    hits = []
    cues = {
        "wiki": ["policy", "onboard", "deploy", "release", "security", "vacation", "pto", "leave", "library", "bundle"],
        "tickets": ["bug", "ticket", "issue", "error", "stall", "citation", "permission", "broke", "fix", "regression"],
        "calendar": ["meeting", "standup", "review", "schedule", "calendar", "when", "event", "offsite"],
    }
    for c, words in cues.items():
        if any(w in q for w in words):
            hits.append(c)
    return hits or ["wiki", "tickets", "calendar"]


def _plan(query: str) -> list[str]:
    """Decide which connectors to consult. Uses Cohere tool-selection when a key is
    present; falls back to a keyword heuristic so the agent always has a plan."""
    if not config.HAS_KEY:
        return _heuristic_plan(query)
    try:
        from cohere_client import get_client
        co = get_client()
        res = co.chat(
            model=config.CHAT_MODEL,
            messages=[{"role": "user", "content": query}],
            tools=TOOLS,
        )
        calls = getattr(res.message, "tool_calls", None) or []
        chosen = []
        for c in calls:
            name = c.function.name
            if name in _CONNECTOR_BY_TOOL and _CONNECTOR_BY_TOOL[name] not in chosen:
                chosen.append(_CONNECTOR_BY_TOOL[name])
        return chosen or _heuristic_plan(query)
    except Exception:
        return _heuristic_plan(query)


def _ground_stream(query: str, docs: list[Doc]) -> Iterator[dict]:
    """Generate the final answer grounded in `docs`, streaming tokens then citations."""
    if not docs:
        yield {"type": "token", "text": "I couldn't find anything about that in the connected sources."}
        return

    if not config.HAS_KEY:
        # Deterministic mock answer that still cites real retrieved docs.
        lead = docs[0]
        answer = (f"Based on **{lead['title']}**, here's what the connected sources say. "
                  f"{lead['text'][:240].rstrip('.')}. ")
        if len(docs) > 1:
            answer += f"This is corroborated by **{docs[1]['title']}**."
        for word in answer.split(" "):
            yield {"type": "token", "text": word + " "}
        # Cite the full first sentence — snapped to a sentence boundary, never a
        # hard character cut (the exact bug class described in TIC-4821).
        first_period = answer.find(". ")
        end = first_period + 1 if first_period != -1 else len(answer)
        yield {"type": "citations", "items": [{
            "start": 0, "end": end,
            "text": answer[:end], "doc_ids": [lead["id"]],
        }]}
        return

    from cohere_client import get_client
    co = get_client()
    documents = [{"id": d["id"], "data": {"title": d["title"], "text": d["text"]}} for d in docs]
    full = []
    citations = []
    try:
        stream = co.chat_stream(
            model=config.CHAT_MODEL,
            messages=[{
                "role": "user",
                "content": (f"{query}\n\nAnswer concisely using ONLY the connected sources. "
                            f"Cite the sources you use."),
            }],
            documents=documents,
        )
        for event in stream:
            etype = getattr(event, "type", "")
            if etype == "content-delta":
                text = event.delta.message.content.text
                full.append(text)
                yield {"type": "token", "text": text}
            elif etype in ("citation-start", "citation"):
                cit = event.delta.message.citations
                start, end = getattr(cit, "start", 0), getattr(cit, "end", 0)
                sources = getattr(cit, "sources", []) or []
                doc_ids = []
                for s in sources:
                    did = getattr(getattr(s, "document", None), "id", None) or s.get("id") if isinstance(s, dict) else None
                    if did:
                        doc_ids.append(did)
                citations.append({"start": start, "end": end,
                                  "text": getattr(cit, "text", ""), "doc_ids": doc_ids})
    except Exception as e:
        # Robust fallback: non-streaming grounded call
        try:
            res = co.chat(
                model=config.CHAT_MODEL,
                messages=[{"role": "user", "content": f"{query}\n\nAnswer using ONLY the connected sources and cite them."}],
                documents=documents,
            )
            text = res.message.content[0].text if res.message.content else ""
            for word in text.split(" "):
                yield {"type": "token", "text": word + " "}
            for cit in (getattr(res.message, "citations", None) or []):
                doc_ids = [getattr(getattr(s, "document", None), "id", None) for s in (getattr(cit, "sources", []) or [])]
                citations.append({"start": getattr(cit, "start", 0), "end": getattr(cit, "end", 0),
                                  "text": getattr(cit, "text", ""), "doc_ids": [d for d in doc_ids if d]})
        except Exception:
            yield {"type": "token", "text": f"(model error: {e})"}
            return

    if citations:
        yield {"type": "citations", "items": citations}


ACTION_CUES = ("draft", "email", "compose", "write to", "send", "schedule", "book")


def _maybe_action(query: str, docs: list[Doc]) -> dict | None:
    """Propose a side-effecting action when the query asks for one. The agent never
    executes it — it emits a proposal and the human allows or denies it (the same
    human-in-the-loop approval pattern North's Agent Studio uses)."""
    q = query.lower()
    if not any(w in q for w in ACTION_CUES):
        return None
    lead = docs[0] if docs else None
    context = f"Grounded on: {lead['title']}.\n" if lead else ""
    return {
        "id": "act-draft-email",
        "kind": "draft_email",
        "title": "Draft an email",
        "summary": "The agent wants to create an email draft from this answer. Nothing is sent without your approval.",
        "detail": (f"To: hr@beacon.example\n"
                   f"Subject: {query.strip().rstrip('?')[:64]}\n\n"
                   f"Hi team,\n\n{context}"
                   f"Following up on the above — could you confirm the details for my records?\n\n"
                   f"Thanks!"),
    }


def run(query: str, allowed: list[str] | None = None) -> Iterator[dict]:
    """Full agent run as a stream of typed events.

    `allowed` scopes the agent to a subset of connectors (the user's toggle state in
    the UI). The plan is filtered to that set — mirroring TIC-5110's requirement that
    unauthorized sources are excluded BEFORE retrieval, never after."""
    yield {"type": "status", "text": "Planning which sources to consult…"}
    scope = [c for c in (allowed or []) if c in CONNECTORS] or None
    connectors = _plan(query)
    if scope is not None:
        connectors = [c for c in connectors if c in scope] or scope
    yield {"type": "plan", "connectors": connectors,
           "labels": [CONNECTORS[c]["label"] for c in connectors]}

    seen: dict[str, Doc] = {}
    for c in connectors:
        yield {"type": "tool_call", "name": f"search_{c}", "connector": c,
               "label": CONNECTORS[c]["label"], "query": query}
        docs = retrieve(query, connector=c)
        yield {"type": "tool_result", "connector": c, "count": len(docs),
               "docs": [{"id": d["id"], "title": d["title"], "url": d["url"], "connector": d["connector"]} for d in docs]}
        for d in docs:
            seen[d["id"]] = d

    ranked = list(seen.values())
    yield {"type": "answer_start", "sources": [
        {"id": d["id"], "title": d["title"], "url": d["url"], "connector": d["connector"], "text": d["text"]}
        for d in ranked]}

    out_chars = 0
    for ev in _ground_stream(query, ranked):
        if ev["type"] == "token":
            out_chars += len(ev["text"])
        yield ev

    action = _maybe_action(query, ranked)
    if action:
        yield {"type": "action_proposal", "action": action}

    # Token/cost estimate (~4 chars/token; Command A list rates $2.50/$10.00 per 1M).
    # Surfacing spend per run matters in agentic UIs: on self-hosted GPUs every
    # wasted token is felt as latency, and on metered APIs as cost.
    in_tokens = max(1, (len(query) + sum(len(d["text"]) for d in ranked)) // 4)
    out_tokens = max(1, out_chars // 4)
    yield {"type": "done", "usage": {
        "input_tokens": in_tokens,
        "output_tokens": out_tokens,
        "est_cost_usd": round(in_tokens * 2.50 / 1e6 + out_tokens * 10.00 / 1e6, 6),
    }}
