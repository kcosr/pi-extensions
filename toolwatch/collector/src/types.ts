// Event types from extension
export interface ToolCallEvent {
  type: "tool_call";
  ts: number;
  toolCallId: string;
  user: string;
  hostname: string;
  session: string | null;
  cwd: string;
  model: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  ts: number;
  toolCallId: string;
  isError: boolean;
  durationMs: number;
  exitCode?: number;
}

export type TelemetryEvent = ToolCallEvent | ToolResultEvent;

// Approval types
export interface ApprovalResponse {
  approved: boolean;
  reason?: string;
}

// Rule types
export type MatchValue = string | string[];
export type MatchCondition = Record<string, MatchValue>;

export interface Rule {
  comment?: string;
  match?: MatchCondition;
  action: "allow" | "deny" | "plugin";
  plugin?: string;
  reason?: string; // returned to agent on deny
}

// Plugin interface
export interface ApprovalPlugin {
  evaluate(event: ToolCallEvent): Promise<ApprovalResponse>;
}

// Config types
export interface Config {
  rules: Rule[];
  plugins: Record<string, string>; // name -> path
}
