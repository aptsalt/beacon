# Loom Narration Script — Beacon demo (62s video: `beacon-demo.mp4`)

Two ways to use this:
- **Option A (fastest):** ship `beacon-demo.mp4` as-is — captions carry the story.
- **Option B (stronger):** record a Loom of yourself driving the live site, reading
  this script, or voice-over the mp4. Your voice > captions for a job application.

Timings below match the mp4. Speak naturally — drift is fine.

---

**[0:00–0:09 · Home screen, cursor sweeps the connector toggles]**
> "This is Beacon — a working homage to Cohere North that I built for this
> application. Three connected workplace sources up top — and each one is a
> toggle that scopes the agent *before* retrieval, so unauthorized text never
> enters the prompt."

**[0:09–0:23 · Clicks "Draft an email to HR…", trace + answer appear, hovers citation]**
> "One click and the agent plans, searches only the sources it needs, and answers
> grounded in what it found — with per-step timings right in the trace.
> These citations are character offsets, and offsets drift — so the renderer
> treats them as untrusted input: clamped, snapped to word boundaries. Hover one
> and its source lights up — claim and evidence stay visually connected."

**[0:23–0:35 · Approval card, clicks Allow, hovers perf footer]**
> "The agent wants to draft an email. It can't — it can only *propose*. Agents
> propose, humans approve. I click Allow, and the mock executor confirms nothing
> was actually sent. And down here: every run renders its own bill — latency per
> stage, tokens in and out, estimated cost. In agentic UIs, token spend is a UX
> metric."

**[0:35–0:53 · Opens ✎ Rate this answer, rates three rows, types comment, submits]**
> "Last thing — and my favorite. A thumbs-up on a whole reply is useless for
> training a model. So Beacon decomposes every answer into ratable parts: the
> plan, each tool call, every sentence, every source. Good, average, or bad —
> each click becomes a run-scoped training record tied to the exact step that
> earned it. That's feedback at the granularity an RLHF pipeline can actually
> consume."

**[0:53–0:62 · GitHub repo end card]**
> "It's live at beacon-ten-sigma.vercel.app, the code's on GitHub — hand-built
> SSE reader, citation renderer, markdown — zero runtime libraries, sixty-five
> kilobytes gzipped. Built the way North has to be built: for environments where
> you can't npm-install your way out. Thanks for watching."

---

*Re-record the video anytime: `cd demo && node record-demo.mjs` (drives the live
deployment; captions and pacing are in `record-demo.mjs`).*
