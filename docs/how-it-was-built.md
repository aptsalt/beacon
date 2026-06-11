# How Beacon Was Built — and What It Says About Working With LLMs

Beacon is a working miniature of a grounded agentic workspace: plan → retrieve →
grounded answer → verifiable citations → human-approved actions → span-level
feedback. This page covers the two things the screenshots can't show — the LLM
engineering inside the product, and the AI-augmented workflow that built it.

---

## Part 1 — The LLM engineering inside the product

### Grounded generation, not chat
The agent never answers from parametric memory. Every run is
**plan → scoped tool calls → embed/cosine retrieve → rerank → grounded generation**,
and the model is constrained to the retrieved documents. Retrieval is two-stage on
purpose: embeddings buy recall cheaply, the reranker buys precision where it
matters. In mock mode the same pipeline runs on keyword scoring, so the
architecture is testable with zero API keys — the model is a swappable component,
not the system.

### Citations are an offsets problem, and offsets drift
Grounded APIs return citations as character spans (`start`, `end`, `doc_ids`)
computed against the text *the model saw*. The text the user sees is different —
markdown stripped, bold rendered, whitespace collapsed. That drift is a real
production bug class (a citation that highlights the wrong sentence destroys the
trust it exists to build). Beacon's renderer treats incoming spans as untrusted:
clamp to the text, snap outward to word boundaries so a citation can never slice a
word, drop overlaps instead of double-rendering. The fix lives in ~15 lines of a
hand-built renderer — because the failure was understood, not patched around.

### Tokens are a UX budget
Streaming LLM tokens arrive faster than a browser should paint. Beacon batches
token flushes with `requestAnimationFrame` — one React commit per frame, not per
token. And because in agentic systems every token is either latency (self-hosted)
or money (metered), each run renders its own bill: per-stage latency plus
estimated token spend (`247 in / 90 out · ~$0.0015`). If you build on LLMs, token
economics is part of the interface.

### Agents propose; humans approve
Side-effecting actions (draft an email) are never executed by the agent. It emits
a typed `action_proposal` event; the UI renders an approval card; the human allows
or denies — and a denial carries an optional *reason* that's recorded for the
agent. Same principle in retrieval: connector toggles filter the plan **before**
documents are fetched, because unauthorized text must never enter the prompt —
filtering output after the fact is too late.

### Feedback designed as training data
A thumbs-up on a whole reply is almost useless for improving a model — it doesn't
say *what* was good. Beacon decomposes every reply into ratable segments — the
plan, each tool call, each answer sentence, each source — and each 👍/👌/👎 is
stored as a structured record keyed to the run:

```json
{"run_id": "6c9328ab…", "segment_type": "answer_sentence",
 "text": "Vacation does not need to be taken in fixed blocks.",
 "rating": "bad", "comment": "Not relevant to my rollover question."}
```

That's a labeling instrument, not a sentiment widget: signal attached to the exact
step that earned it, at the granularity RLHF-style pipelines actually consume.

---

## Part 2 — The workflow that built it

Beacon was built in roughly one evening, working with Claude Code as an agentic
pair. The interesting part isn't the speed — it's the discipline that keeps
AI-speed output trustworthy.

**Research before pixels.** A research agent swept Cohere's site, blog, press, and
job postings to map North's feature surface and its documented gaps. The visual
theme isn't "inspired by" — the palette was scraped from cohere.com/north's own
CSS. Three features (action approval, cost metering, span feedback) each target
something specific that research surfaced.

**Verify in the running product, not the diff.** Every change was checked in a
live browser via Playwright — screenshots, accessibility-tree inspection, SSE
transcripts via curl, and reading the actual JSONL the feedback endpoint wrote.
"It compiles" was never the bar; "I watched it work" was.

**The verification loop caught what review wouldn't.** Looking at the rendered
app exposed a citation highlight cutting mid-word ("Full-time e¹mployees") — the
offset-drift bug — which code review of the diff would likely have missed. It also
exposed an ops bug: an edited backend that *appeared* restarted was still the old
process serving stale logic (git-bash `kill` can't terminate Windows processes;
`taskkill` can). Both fixes are in the product because the loop was
look-at-reality, not trust-the-edit.

**The AI is leverage; the judgment is the job.** Claude wrote most of the
characters. The decisions that shaped the product — build primitives instead of
importing libraries, treat citation spans as untrusted input, gate actions on
humans, design feedback as training data, hold a 65 KB bundle budget — are
engineering judgment. That division of labor is the point: an engineer who directs
agentic tools well ships in an evening what used to take a week, **without
lowering the bar for what counts as done.**

---

*Built by Deepak Singh Kandari. FastAPI + Cohere v2 SDK · React 19 + TypeScript
(strict) · zero runtime UI/markdown/streaming libraries · 65.3 KB gzipped.*
