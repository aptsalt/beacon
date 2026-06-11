// Typed events streamed from the agent backend over SSE.
export type SourceDoc = {
  id: string;
  title: string;
  url: string;
  connector: string;
  text?: string;
};

export type Citation = {
  start: number;
  end: number;
  text: string;
  doc_ids: string[];
};

/** A side-effecting action the agent proposes but never executes on its own. */
export type AgentAction = {
  id: string;
  kind: string;
  title: string;
  summary: string;
  detail: string;
};

/** Estimated token usage + cost for one agent run. */
export type Usage = {
  input_tokens: number;
  output_tokens: number;
  est_cost_usd: number;
};

export type BeaconEvent =
  | { type: "status"; text: string }
  | { type: "plan"; connectors: string[]; labels: string[] }
  | { type: "tool_call"; name: string; connector: string; label: string; query: string }
  | { type: "tool_result"; connector: string; count: number; docs: SourceDoc[] }
  | { type: "answer_start"; sources: SourceDoc[] }
  | { type: "token"; text: string }
  | { type: "citations"; items: Citation[] }
  | { type: "action_proposal"; action: AgentAction }
  | { type: "error"; message: string }
  | { type: "done"; usage?: Usage };

export type TraceStep =
  | { kind: "status"; text: string; at?: number }
  | { kind: "plan"; labels: string[]; at?: number }
  | { kind: "tool"; label: string; query: string; count?: number; at?: number };

/** Client-measured stage latencies (ms since the request was sent). */
export type PerfMetrics = {
  plan?: number;
  firstToken?: number;
  total?: number;
};

export type ActionState = {
  status: "pending" | "executed" | "declined";
  result?: string;
};

export type Rating = "good" | "average" | "bad";

/** One ratable unit of an agent run — the granularity feedback is collected at. */
export type FeedbackSegment = {
  id: string;
  type: "plan" | "tool_call" | "answer_sentence" | "source";
  text: string;
};

export type ChatMessage = {
  role: "user" | "assistant";
  text: string;
  trace: TraceStep[];
  sources: SourceDoc[];
  citations: Citation[];
  streaming: boolean;
  perf?: PerfMetrics;
  stopped?: boolean;
  usage?: Usage;
  action?: AgentAction;
  actionState?: ActionState;
  runId: string;
  query: string;
};
