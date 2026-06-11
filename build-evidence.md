# Build Evidence — Beacon (Cohere North homage)

| Meta | |
|---|---|
| Date | 2026-06-10 → 2026-06-11 (two sessions, ~one evening total) |
| Repo | `C:\Users\deepc\beacon` (git initialized, pre-first-commit) |
| Status | ✅ Builds clean · ✅ typecheck clean · ✅ browser-verified E2E |
| Stack | FastAPI + Cohere v2 SDK (mock-capable) · Vite + React 19 + TS strict |
| Footprint | **65.3 KB gzipped JS · 2.5 KB CSS** — zero runtime UI/markdown/streaming libraries |
| Codebase | 1,449 lines across 11 source files |

## Executive Summary

Built a working miniature of Cohere North — grounded agentic RAG with verifiable
citations, human-approved actions, and span-level feedback collection — themed with
Cohere's actual brand palette, as the portfolio centerpiece for the Senior Full-Stack
(Front-End Leaning), Agentic Platform application. Every feature was verified in a
live browser (Playwright), not just compiled.

## Achievement Log

| # | Achievement | Evidence |
|---|---|---|
| 1 | Agentic RAG pipeline: plan → scoped tool calls → embed/rerank retrieve → grounded answer with citation offsets, streamed as 10 typed SSE events | `backend/agent.py`, `backend/rag.py`; curl transcript of full event stream |
| 2 | Citation span hygiene — fixed the offset-drift bug class (raw vs rendered text): clamp, word-boundary snap, overlap drop, bold-inside-mark | `App.tsx renderInline()`; before/after screenshots `beacon-answer.png` → `beacon-fixed.png` |
| 3 | rAF-batched token streaming — one React commit per paint instead of per token | `App.tsx send()` flush logic |
| 4 | Human-in-the-loop action approval (Agent Studio pattern): `action_proposal` event → AWAITING APPROVAL card → Allow/Deny-with-reason → mock executor | `POST /api/action`; `beacon-action.png`, `beacon-fb-done.png` (✓ APPROVED state) |
| 5 | Token/cost observability: per-run usage estimate at Command A rates rendered in perf footer (`247 in / 90 out · ~$0.0015`) | `done` event usage payload; footer visible in `beacon-action.png` |
| 6 | Span-level feedback system: reply decomposes into rated segments (plan / tool calls / answer sentences / sources), 👍👌👎 each, pinpoint comment, persisted as JSONL training records keyed by run_id | `POST /api/feedback` → `backend/data/feedback.jsonl` (2 records); `beacon-fb-rated.png` |
| 7 | Cohere North visual identity: palette scraped from cohere.com/north (`#f0eee9` cream, `#062c22` forest, `#00a04d` vivid, `#da532c` coral) | `index.css`; `beacon-north-empty.png` |
| 8 | Connector scoping: header toggles → agent plan filtered **before** retrieval (permission-first pattern, mirrors TIC-5110) | `agent.py run(allowed=)`; a11y snapshot showing scoped plan |
| 9 | Stop generation (AbortController), per-stage latency trace (+ms per step), perf footer | `beacon-final.png` |
| 10 | A11y: `role=log` + `aria-live` streaming, `aria-pressed` toggles, focusable citations, `/` shortcut, radiogroup ratings | Playwright a11y-tree snapshots |

## Changeset

| Area | Files | Lines | Category |
|---|---|---|---|
| Backend | `agent.py`, `main.py`, `rag.py`, `connectors.py`, `config.py`, `cohere_client.py` | 553 | feature |
| Frontend | `App.tsx`, `api.ts`, `types.ts`, `index.css`, `main.tsx` | 896 | feature |
| Artifacts | `data/feedback.jsonl` (training records), 9 verification screenshots | — | evidence |

## Quality Signals

| Signal | Result |
|---|---|
| TypeScript (`tsc -b`, strict) | ✅ clean |
| Production build (Vite) | ✅ 65.33 KB gzip JS / 2.50 KB CSS |
| Browser E2E (Playwright MCP) | ✅ all 6 flows: ask, cite-hover linking, connector scoping, action allow/deny, feedback submit, stop |
| Backend endpoints | ✅ curl-verified: `/api/health`, `/api/chat` (SSE), `/api/action`, `/api/feedback` |
| Unit tests | None (demo project — verification is browser-E2E based) |
| Secrets | ✅ none in repo; Cohere key via `backend/.env` (gitignored pattern needed pre-commit) |

## Critic Assessment

- The self-referential design holds: mock tickets TIC-4821/5093/5110 describe bug
  classes the app itself demonstrably fixes (citation offsets, paint-batched
  streaming, permission-before-retrieval).
- Honest mock boundaries: action executor and token estimates clearly labeled as
  mock/estimated in-UI — no fabricated capability claims.
- Feedback schema is genuinely training-grade (run-scoped, segment-typed) but
  collection only — no consumption loop yet (acceptable for demo, say so if asked).

## Risk & Gaps

| Gap | Severity | Note |
|---|---|---|
| No initial git commit yet | High | Whole tree untracked; commit + `.gitignore` (.env, .venv, node_modules, .embed_cache) before sharing |
| No tests | Med | Browser-E2E only; a couple of vitest specs on `renderInline` span hygiene would strengthen the craft story |
| Real-Cohere path untested this session | Med | Mock mode verified; live mode needs a `COHERE_API_KEY` smoke run before demoing |
| Not deployed | Med | Localhost only; Vercel + small Python host pending |
| Feedback has no consumption/eval loop | Low | Positioning: "collection instrument" |

## What's Next

1. Initial commit + `.gitignore`, then deploy (frontend + backend)
2. Case study page (uses this receipt as raw material)
3. Live-mode smoke test with real Cohere key
4. 90-second Loom walkthrough
5. Tailored resume + cover letter
