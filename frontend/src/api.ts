import type { BeaconEvent, Rating } from "./types";

// Same-origin by default in production (frontend + API behind one host);
// VITE_API_BASE overrides for split hosting; localhost:8000 for dev.
const BASE = import.meta.env.VITE_API_BASE ?? (import.meta.env.DEV ? "http://localhost:8000" : "");

export async function decideAction(
  action_id: string,
  decision: "allow" | "deny",
  reason?: string,
): Promise<{ status: "executed" | "declined"; result: string }> {
  const r = await fetch(`${BASE}/api/action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action_id, decision, reason }),
  });
  return r.json();
}

export async function sendFeedback(payload: {
  run_id: string;
  query: string;
  mode?: string;
  items: { segment_id: string; segment_type: string; text: string; rating: Rating }[];
  comment?: string;
}): Promise<{ ok: boolean; stored: number }> {
  const r = await fetch(`${BASE}/api/feedback`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

export async function getHealth(): Promise<{ mode: string; chat_model: string | null }> {
  const r = await fetch(`${BASE}/api/health`);
  return r.json();
}

/**
 * Stream a chat turn. Parses the SSE response by hand (no EventSource — we need POST)
 * and dispatches each typed event. This is one of the deliberately hand-built
 * primitives: a minimal, dependency-free SSE reader over fetch + ReadableStream.
 */
export async function streamChat(
  message: string,
  connectors: string[] | undefined,
  onEvent: (e: BeaconEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, connectors }),
    signal,
  });
  if (!res.body) throw new Error("No response stream");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line; each "data:" line carries one JSON event.
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      for (const line of frame.split("\n")) {
        if (line.startsWith("data:")) {
          const json = line.slice(5).trim();
          if (json) {
            try { onEvent(JSON.parse(json) as BeaconEvent); } catch { /* ignore partial */ }
          }
        }
      }
    }
  }
}
