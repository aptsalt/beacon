"""Beacon backend — FastAPI. Streams the agent's run to the UI over Server-Sent Events.
Health endpoint reports whether real Cohere is wired (key present) or mock mode."""
import json
import os
from datetime import datetime, timezone

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

import config
from agent import run
from connectors import CONNECTORS

app = FastAPI(title="Beacon — Grounded Agentic Workspace")
app.add_middleware(
    CORSMiddleware,
    allow_origins=config.ALLOWED_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ChatRequest(BaseModel):
    message: str
    connectors: list[str] | None = None  # scope the agent to these connectors (None = all)


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "mode": "cohere" if config.HAS_KEY else "mock",
        "chat_model": config.CHAT_MODEL if config.HAS_KEY else None,
    }


@app.get("/api/connectors")
def connectors():
    return [
        {"key": k, "label": m["label"], "icon": m["icon"], "doc_count": len(m["docs"])}
        for k, m in CONNECTORS.items()
    ]


def _sse(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@app.post("/api/chat")
def chat(req: ChatRequest):
    def gen():
        try:
            for event in run(req.message, allowed=req.connectors):
                yield _sse(event)
        except Exception as e:  # surface errors to the UI instead of dropping the stream
            yield _sse({"type": "error", "message": str(e)})
            yield _sse({"type": "done"})

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Human-in-the-loop action approval ────────────────────────────────────────
class ActionDecision(BaseModel):
    action_id: str
    decision: str  # "allow" | "deny"
    reason: str | None = None


@app.post("/api/action")
def action(req: ActionDecision):
    """Execute (mock) or cancel a proposed agent action. The agent only ever
    proposes; the human decides — side effects never happen without approval."""
    if req.decision == "allow":
        return {"ok": True, "status": "executed",
                "result": "Draft created in your Outbox. (Mock executor — nothing was sent. "
                          "In production this calls the connector's write API behind the same permission layer.)"}
    note = f" Your reason was recorded for the agent: “{req.reason}”" if req.reason else ""
    return {"ok": True, "status": "declined", "result": f"Action cancelled — no side effects.{note}"}


# ── Span-level feedback (the training-data flywheel) ─────────────────────────
class FeedbackItem(BaseModel):
    segment_id: str
    segment_type: str  # plan | tool_call | answer_sentence | source
    text: str
    rating: str        # good | average | bad


class FeedbackPayload(BaseModel):
    run_id: str
    query: str
    mode: str | None = None
    items: list[FeedbackItem]
    comment: str | None = None


_FEEDBACK_PATH = os.path.join(os.path.dirname(__file__), "data", "feedback.jsonl")


@app.post("/api/feedback")
def feedback(req: FeedbackPayload):
    """Append structured, span-level feedback to a JSONL log. Each record labels a
    specific segment of a specific run (plan step, tool call, answer sentence, or
    source) — exactly the granularity needed to train/evaluate the agent, instead
    of a single thumbs-up on a whole reply."""
    record = {"ts": datetime.now(timezone.utc).isoformat(), **req.model_dump()}
    os.makedirs(os.path.dirname(_FEEDBACK_PATH), exist_ok=True)
    with open(_FEEDBACK_PATH, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    return {"ok": True, "stored": len(req.items)}
