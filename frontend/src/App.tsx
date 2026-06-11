import { useEffect, useRef, useState } from "react";
import { decideAction, getHealth, sendFeedback, streamChat } from "./api";
import type { ChatMessage, SourceDoc, Citation, Rating, FeedbackSegment } from "./types";
import "./index.css";

const CONNECTOR_META: Record<string, { label: string; dot: string }> = {
  wiki: { label: "Company Wiki", dot: "#00a04d" },
  tickets: { label: "Support Tickets", dot: "#da532c" },
  calendar: { label: "Team Calendar", dot: "#152455" },
};
const ALL_CONNECTORS = Object.keys(CONNECTOR_META);

const SUGGESTIONS = [
  "How many vacation days do I get, and how does rollover work?",
  "A customer says citations point to the wrong sentence — is that a known issue?",
  "Why can't we just use any open-source UI library here?",
  "Draft an email to HR asking about my vacation rollover",
];

const newRunId = () =>
  (crypto.randomUUID?.() ?? `run-${Date.now()}-${Math.random().toString(36).slice(2)}`);

export default function App() {
  const [mode, setMode] = useState<string>("…");
  const [model, setModel] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [enabled, setEnabled] = useState<Set<string>>(new Set(ALL_CONNECTORS));
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => { getHealth().then((h) => { setMode(h.mode); setModel(h.chat_model); }).catch(() => setMode("offline")); }, []);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  // "/" focuses the composer from anywhere (unless already typing somewhere).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName ?? "")) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function toggleConnector(key: string) {
    setEnabled((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size === 1) return prev; // an agent with zero sources is meaningless
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function stop() {
    abortRef.current?.abort();
  }

  /** Patch the assistant message at a fixed index (used by action/feedback UIs). */
  const patchAt = (idx: number) => (fn: (a: ChatMessage) => ChatMessage) =>
    setMessages((m) => { const c = [...m]; if (c[idx]) c[idx] = fn(c[idx]); return c; });

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const runId = newRunId();
    setMessages((m) => [
      ...m,
      { role: "user", text: q, trace: [], sources: [], citations: [], streaming: false, runId, query: q },
      { role: "assistant", text: "", trace: [], sources: [], citations: [], streaming: true, perf: {}, runId, query: q },
    ]);

    const patch = (fn: (a: ChatMessage) => ChatMessage) =>
      setMessages((m) => { const c = [...m]; const i = c.length - 1; c[i] = fn(c[i]); return c; });

    const t0 = performance.now();
    const since = () => Math.round(performance.now() - t0);

    // Token batching (the TIC-5093 fix): accumulate streamed tokens and flush at
    // most once per animation frame — one React commit per paint instead of one
    // per token, so the stream stays smooth even on long answers.
    let pending = "";
    let raf = 0;
    let sawFirstToken = false;
    const flush = () => {
      raf = 0;
      if (!pending) return;
      const chunk = pending;
      pending = "";
      patch((a) => ({ ...a, text: a.text + chunk }));
    };
    const flushNow = () => { if (raf) { cancelAnimationFrame(raf); } flush(); };

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamChat(q, Array.from(enabled), (e) => {
        if (e.type === "token") {
          if (!sawFirstToken) {
            sawFirstToken = true;
            const ft = since();
            patch((a) => ({ ...a, perf: { ...a.perf, firstToken: ft } }));
          }
          pending += e.text;
          if (!raf) raf = requestAnimationFrame(flush);
          return;
        }
        flushNow(); // citations/done index into the text — make sure it's all applied first
        if (e.type === "status") patch((a) => ({ ...a, trace: [...a.trace, { kind: "status", text: e.text, at: since() }] }));
        else if (e.type === "plan") {
          const at = since();
          patch((a) => ({ ...a, perf: { ...a.perf, plan: at }, trace: [...a.trace, { kind: "plan", labels: e.labels, at }] }));
        }
        else if (e.type === "tool_call") patch((a) => ({ ...a, trace: [...a.trace, { kind: "tool", label: e.label, query: e.query, at: since() }] }));
        else if (e.type === "tool_result") patch((a) => {
          const t = [...a.trace];
          for (let i = t.length - 1; i >= 0; i--) {
            const step = t[i];
            if (step.kind === "tool" && step.count === undefined) { t[i] = { ...step, count: e.count }; break; }
          }
          return { ...a, trace: t };
        });
        else if (e.type === "answer_start") patch((a) => ({ ...a, sources: e.sources }));
        else if (e.type === "citations") patch((a) => ({ ...a, citations: e.items }));
        else if (e.type === "action_proposal") patch((a) => ({ ...a, action: e.action, actionState: { status: "pending" } }));
        else if (e.type === "error") patch((a) => ({ ...a, text: a.text + `\n\n⚠️ ${e.message}` }));
        else if (e.type === "done") {
          const total = since();
          patch((a) => ({ ...a, streaming: false, usage: e.usage, perf: { ...a.perf, total } }));
        }
      }, controller.signal);
      flushNow();
    } catch (err) {
      flushNow();
      const aborted = (err as Error).name === "AbortError";
      patch((a) => ({
        ...a,
        text: aborted ? a.text : (a.text || `⚠️ ${(err as Error).message}`),
        streaming: false,
        stopped: aborted,
        perf: { ...a.perf, total: since() },
      }));
    } finally {
      abortRef.current = null;
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◆</span>
          <div>
            <div className="title">Beacon</div>
            <div className="subtitle">Secure agentic workspace · a North homage</div>
          </div>
        </div>
        <div className="modes">
          {Object.entries(CONNECTOR_META).map(([k, v]) => {
            const on = enabled.has(k);
            return (
              <button
                key={k}
                className={`conn ${on ? "" : "off"}`}
                aria-pressed={on}
                title={on ? `${v.label} — connected. Click to exclude from agent runs.` : `${v.label} — excluded. Click to reconnect.`}
                onClick={() => toggleConnector(k)}
              >
                <span className="dot" style={{ background: v.dot }} />
                {v.label}
              </button>
            );
          })}
          <span className={`mode ${mode === "cohere" ? "live" : ""}`} title={model ?? ""}>
            {mode === "cohere" ? `● live · ${model}` : mode === "mock" ? "● mock (add Cohere key)" : `● ${mode}`}
          </span>
        </div>
      </header>

      <main className="stream" ref={scrollRef} role="log" aria-live="polite" aria-busy={busy}>
        {messages.length === 0 ? (
          <div className="empty">
            <h1>Ask across your <span>connected</span> workplace.</h1>
            <p>Every answer is grounded in real sources, with citations you can verify — and actions you approve.</p>
            <div className="suggest">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)}>{s}</button>
              ))}
            </div>
            <p className="craft">
              Hand-built primitives: SSE reader, citation renderer, mini-markdown, rAF-batched streaming —
              zero runtime UI/markdown/streaming libraries. Press <kbd>/</kbd> to ask.
            </p>
          </div>
        ) : (
          messages.map((m, i) =>
            m.role === "user"
              ? <UserBubble key={i} text={m.text} />
              : <AssistantCard key={i} msg={m} mode={mode} onPatch={patchAt(i)} />)
        )}
      </main>

      <footer className="composer">
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") send(input); }}
          placeholder="Ask your connected workspace…  ( / )"
          aria-label="Ask your connected workspace"
          disabled={busy}
        />
        {busy ? (
          <button className="stop" onClick={stop} aria-label="Stop generating">⏹ Stop</button>
        ) : (
          <button onClick={() => send(input)} disabled={!input.trim()}>Ask</button>
        )}
      </footer>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return <div className="row user"><div className="bubble">{text}</div></div>;
}

function AssistantCard({ msg, mode, onPatch }: {
  msg: ChatMessage;
  mode: string;
  onPatch: (fn: (a: ChatMessage) => ChatMessage) => void;
}) {
  // Hover/focus a citation ⇄ highlight its source row (and vice versa): keeps the
  // claim and its evidence visually connected — the point of inline citations.
  const [focusDoc, setFocusDoc] = useState<string | null>(null);
  const [fbOpen, setFbOpen] = useState(false);
  return (
    <div className="row assistant">
      <div className="card">
        {msg.trace.length > 0 && <Trace msg={msg} />}
        <div className="answer">
          {renderInline(msg.text, msg.citations, msg.sources, focusDoc, setFocusDoc)}
          {msg.streaming && <span className="caret" aria-hidden="true" />}
          {msg.stopped && <span className="stoppedtag"> — stopped</span>}
        </div>
        {msg.action && msg.actionState && <ActionCard msg={msg} onPatch={onPatch} />}
        {msg.sources.length > 0 && !msg.streaming && (
          <Sources sources={msg.sources} citations={msg.citations} focusDoc={focusDoc} setFocusDoc={setFocusDoc} />
        )}
        {!msg.streaming && msg.perf?.total !== undefined && (
          <div className="cardfoot">
            <Perf msg={msg} />
            <button className="fbtoggle" aria-expanded={fbOpen} onClick={() => setFbOpen((v) => !v)}>
              {fbOpen ? "✕ Close feedback" : "✎ Rate this answer"}
            </button>
          </div>
        )}
        {fbOpen && !msg.streaming && <FeedbackPanel msg={msg} mode={mode} />}
      </div>
    </div>
  );
}

// ── Human-in-the-loop action approval (the Agent Studio pattern) ─────────────
function ActionCard({ msg, onPatch }: {
  msg: ChatMessage;
  onPatch: (fn: (a: ChatMessage) => ChatMessage) => void;
}) {
  const action = msg.action!;
  const state = msg.actionState!;
  const [denying, setDenying] = useState(false);
  const [reason, setReason] = useState("");
  const [waiting, setWaiting] = useState(false);

  async function decide(decision: "allow" | "deny") {
    setWaiting(true);
    try {
      const res = await decideAction(action.id, decision, decision === "deny" ? reason.trim() || undefined : undefined);
      onPatch((a) => ({ ...a, actionState: { status: res.status, result: res.result } }));
    } catch (e) {
      onPatch((a) => ({ ...a, actionState: { status: "declined", result: `⚠️ ${(e as Error).message}` } }));
    } finally {
      setWaiting(false);
    }
  }

  return (
    <div className={`action ${state.status}`} role="group" aria-label="Proposed agent action">
      <div className="ahead">
        <span className="abadge">{state.status === "pending" ? "⏸ awaiting approval" : state.status === "executed" ? "✓ approved" : "✕ denied"}</span>
        <span className="atitle">✉ {action.title}</span>
      </div>
      <p className="asummary">{action.summary}</p>
      <pre className="adetail">{action.detail}</pre>
      {state.status === "pending" ? (
        denying ? (
          <div className="adeny">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why? (optional — the agent learns from this)"
              aria-label="Reason for denying"
              onKeyDown={(e) => { if (e.key === "Enter") decide("deny"); }}
            />
            <button className="ghost" disabled={waiting} onClick={() => decide("deny")}>Confirm deny</button>
            <button className="ghost" disabled={waiting} onClick={() => setDenying(false)}>Back</button>
          </div>
        ) : (
          <div className="abtns">
            <button className="allow" disabled={waiting} onClick={() => decide("allow")}>Allow</button>
            <button className="deny" disabled={waiting} onClick={() => setDenying(true)}>Deny…</button>
          </div>
        )
      ) : (
        <p className="aresult">{state.result}</p>
      )}
    </div>
  );
}

// ── Span-level feedback (the training-data flywheel) ─────────────────────────
const RATING_META: { key: Rating; icon: string; label: string }[] = [
  { key: "good", icon: "👍", label: "Good" },
  { key: "average", icon: "👌", label: "Average" },
  { key: "bad", icon: "👎", label: "Bad" },
];

function segmentsFor(msg: ChatMessage): FeedbackSegment[] {
  const segs: FeedbackSegment[] = [];
  msg.trace.forEach((s, i) => {
    if (s.kind === "plan") segs.push({ id: `plan-${i}`, type: "plan", text: `Plan: consult ${s.labels.join(", ")}` });
    else if (s.kind === "tool") segs.push({ id: `tool-${i}`, type: "tool_call", text: `search · ${s.label}${s.count !== undefined ? ` → ${s.count} sources` : ""}` });
  });
  msg.text.split(/(?<=\.)\s+/).map((s) => s.trim()).filter((s) => s.length > 1).forEach((s, i) =>
    segs.push({ id: `ans-${i}`, type: "answer_sentence", text: s }));
  msg.sources.forEach((s) => segs.push({ id: `src-${s.id}`, type: "source", text: `Source: ${s.title}` }));
  return segs;
}

const SEG_LABEL: Record<FeedbackSegment["type"], string> = {
  plan: "Agent plan",
  tool_call: "Tool calls",
  answer_sentence: "Answer — sentence by sentence",
  source: "Sources retrieved",
};

function FeedbackPanel({ msg, mode }: { msg: ChatMessage; mode: string }) {
  const [ratings, setRatings] = useState<Record<string, Rating>>({});
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const segs = segmentsFor(msg);
  const rated = Object.keys(ratings).length;

  function rate(id: string, r: Rating) {
    setRatings((prev) => {
      const next = { ...prev };
      if (next[id] === r) delete next[id]; // click again to clear
      else next[id] = r;
      return next;
    });
  }

  async function submit() {
    if (!rated) return;
    setState("sending");
    try {
      const items = segs.filter((s) => ratings[s.id]).map((s) => ({
        segment_id: s.id, segment_type: s.type, text: s.text, rating: ratings[s.id],
      }));
      await sendFeedback({ run_id: msg.runId, query: msg.query, mode, items, comment: comment.trim() || undefined });
      setState("done");
    } catch {
      setState("error");
    }
  }

  if (state === "done") {
    return (
      <div className="fb" role="status">
        <p className="fbdone">✓ {rated} span-level signal{rated === 1 ? "" : "s"} recorded. This is the structured
        data that trains the agent — not a thumbs-up on a whole reply, but a label on the exact step that earned it.</p>
      </div>
    );
  }

  let lastType: string | null = null;
  return (
    <div className="fb" aria-label="Rate parts of this answer">
      <p className="fbhint">Rate the exact parts that were right or wrong — each rating becomes a training signal
      tied to that specific step of the run.</p>
      {segs.map((s) => {
        const header = s.type !== lastType ? <div key={`h-${s.id}`} className="fbgroup">{SEG_LABEL[s.type]}</div> : null;
        lastType = s.type;
        return (
          <div key={`w-${s.id}`}>
            {header}
            <div className={`fbrow ${ratings[s.id] ? `is-${ratings[s.id]}` : ""}`}>
              <span className="fbtext"><Bold text={s.text} /></span>
              <span className="fbbtns" role="radiogroup" aria-label={`Rate: ${s.text.slice(0, 50)}`}>
                {RATING_META.map((r) => (
                  <button
                    key={r.key}
                    className={`fbr ${r.key}${ratings[s.id] === r.key ? " sel" : ""}`}
                    aria-pressed={ratings[s.id] === r.key}
                    title={r.label}
                    onClick={() => rate(s.id, r.key)}
                  >{r.icon}</button>
                ))}
              </span>
            </div>
          </div>
        );
      })}
      <div className="fbfoot">
        <input
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Anything to point at exactly? (optional)"
          aria-label="Additional feedback comment"
        />
        <button className="fbsubmit" disabled={!rated || state === "sending"} onClick={submit}>
          {state === "sending" ? "…" : `Send ${rated || ""} signal${rated === 1 ? "" : "s"}`}
        </button>
      </div>
      {state === "error" && <p className="fberr">⚠️ Couldn't store feedback — is the backend up?</p>}
    </div>
  );
}

function Perf({ msg }: { msg: ChatMessage }) {
  const perf = msg.perf ?? {};
  const fmt = (ms?: number) => (ms === undefined ? "—" : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);
  const u = msg.usage;
  return (
    <div className="perf" title="Client-measured stage latencies + estimated token spend (Command A list rates)">
      <span>⏱ plan {fmt(perf.plan)}</span>
      <span>first token {fmt(perf.firstToken)}</span>
      <span>total {fmt(perf.total)}</span>
      {u && <span className="tok">{u.input_tokens.toLocaleString()} in / {u.output_tokens.toLocaleString()} out · ~${u.est_cost_usd.toFixed(4)}</span>}
    </div>
  );
}

function Trace({ msg }: { msg: ChatMessage }) {
  return (
    <div className="trace">
      {msg.trace.map((s, i) => {
        const at = s.at !== undefined && <span className="at">+{s.at}ms</span>;
        if (s.kind === "status") return <div key={i} className="tstep muted"><span>{s.text}</span>{at}</div>;
        if (s.kind === "plan") return <div key={i} className="tstep"><span>🧭 Plan: consult {s.labels.join(", ")}</span>{at}</div>;
        return (
          <div key={i} className="tstep">
            <span>🔧 search · {s.label}{s.count !== undefined ? ` → ${s.count} source${s.count === 1 ? "" : "s"}` : "…"}</span>
            {at}
          </div>
        );
      })}
    </div>
  );
}

/**
 * From-scratch inline renderer (no markdown library): splits the answer by citation
 * spans, wraps cited text in a <mark> with a numbered superscript, and renders
 * **bold** inside every segment — cited or not. A deliberate hand-built primitive
 * (the JD calls out that popular libraries sometimes can't be used).
 *
 * Span hygiene (the TIC-4821 bug class): offsets from the model can drift from the
 * rendered string, so every span is clamped to the text, snapped outward to word
 * boundaries (a citation must never slice a word in half), and overlaps are dropped.
 */
function renderInline(
  text: string,
  citations: Citation[],
  sources: SourceDoc[],
  focusDoc: string | null,
  setFocusDoc: (id: string | null) => void,
) {
  if (!text) return null;
  const idxOf = (id: string) => sources.findIndex((s) => s.id === id);

  const snapStart = (i: number) => { let j = Math.max(0, Math.min(i, text.length)); while (j > 0 && !/\s/.test(text[j - 1])) j--; return j; };
  const snapEnd = (i: number) => { let j = Math.max(0, Math.min(i, text.length)); while (j < text.length && !/\s/.test(text[j])) j++; return j; };

  const cits = citations
    .map((c) => ({ ...c, start: snapStart(c.start), end: snapEnd(c.end) }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);

  const out: React.ReactNode[] = [];
  let cursor = 0;
  cits.forEach((c, k) => {
    if (c.start < cursor) return; // drop overlapping span rather than double-render
    if (c.start > cursor) out.push(<Bold key={`t${k}`} text={text.slice(cursor, c.start)} />);
    const nums = c.doc_ids.map(idxOf).filter((n) => n >= 0).map((n) => n + 1);
    const active = focusDoc !== null && c.doc_ids.includes(focusDoc);
    out.push(
      <mark
        key={`c${k}`}
        className={`cite${active ? " on" : ""}`}
        tabIndex={0}
        title={c.doc_ids.map((id) => sources.find((s) => s.id === id)?.title).filter(Boolean).join(" · ")}
        onMouseEnter={() => setFocusDoc(c.doc_ids[0] ?? null)}
        onMouseLeave={() => setFocusDoc(null)}
        onFocus={() => setFocusDoc(c.doc_ids[0] ?? null)}
        onBlur={() => setFocusDoc(null)}
      >
        <Bold text={text.slice(c.start, c.end)} />
        {nums.length > 0 && <sup>{nums.join(",")}</sup>}
      </mark>,
    );
    cursor = c.end;
  });
  if (cursor < text.length) out.push(<Bold key="tail" text={text.slice(cursor)} />);
  return out;
}

// Tiny **bold** parser — also hand-built, no library.
function Bold({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <span key={i}>{p}</span>))}</>;
}

function Sources({ sources, citations, focusDoc, setFocusDoc }: {
  sources: SourceDoc[];
  citations: Citation[];
  focusDoc: string | null;
  setFocusDoc: (id: string | null) => void;
}) {
  const citedIds = new Set(citations.flatMap((c) => c.doc_ids));
  return (
    <div className="sources" role="list" aria-label="Sources">
      <div className="slabel">Sources</div>
      {sources.map((s, i) => (
        <div
          key={s.id}
          role="listitem"
          className={`src ${citedIds.has(s.id) ? "used" : ""}${focusDoc === s.id ? " hl" : ""}`}
          onMouseEnter={() => setFocusDoc(s.id)}
          onMouseLeave={() => setFocusDoc(null)}
        >
          <span className="snum">{i + 1}</span>
          <span className="dot" style={{ background: CONNECTOR_META[s.connector]?.dot ?? "#888" }} />
          <span className="stitle">{s.title}</span>
          <span className="sconn">{CONNECTOR_META[s.connector]?.label ?? s.connector}</span>
        </div>
      ))}
    </div>
  );
}
