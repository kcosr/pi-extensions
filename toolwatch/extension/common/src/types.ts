/**
 * Shared types for toolwatch extension and collector.
 */

// ============================================================================
// Event Types
// ============================================================================

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

export type ToolwatchEvent = ToolCallEvent | ToolResultEvent;

// ============================================================================
// Approval Types
// ============================================================================

export interface ApprovalResponse {
  approved: boolean;
  reason?: string;
}

// ============================================================================
// Rule Types
// ============================================================================

/** Match value: single pattern or array of patterns (OR) */
export type MatchValue = string | string[];

/** Match condition: field path -> match value (AND across fields) */
export type MatchCondition = Record<string, MatchValue>;

export interface Rule {
  /** Human-readable comment */
  comment?: string;
  /** Condition to match (empty = matches all) */
  match?: MatchCondition;
  /** Action to take when matched */
  action: "allow" | "deny" | "manual" | "plugin";
  /** Plugin name (required if action = "plugin") */
  plugin?: string;
  /** Reason returned to agent on deny */
  reason?: string;
}

// ============================================================================
// Plugin Types
// ============================================================================

/**
 * Plugin interface for custom approval logic.
 * Context type varies by environment:
 * - Local (extension): ExtensionContext for TUI access
 * - Remote (collector): ToolwatchDB for database access
 */
export interface ApprovalPlugin<TContext = unknown> {
  evaluate(event: ToolCallEvent, ctx?: TContext): Promise<ApprovalResponse>;
}

// ============================================================================
// Config Types
// ============================================================================

export interface RulesConfig {
  mode: "local" | "remote" | "none";
  /** Rules to evaluate (local mode only) */
  rules?: Rule[];
  /** Plugin name -> path mapping (local mode only) */
  plugins?: Record<string, string>;
  /** Timeout in ms for remote mode. 0 or undefined = no timeout */
  timeoutMs?: number;
  /** Action on error (timeout, HTTP failure): "block" (deny) or "allow" */
  errorAction?: "block" | "allow";
}

export interface AuditConfig {
  mode: "none" | "file" | "http" | "both" | "http-with-fallback";
  http?: { url: string };
  file?: { path: string };
}

export interface Config {
  rules: RulesConfig;
  audit: AuditConfig;
  /** Tools to process. Empty array = all tools */
  tools: string[];
}

// ============================================================================
// Collector Config (rules file based)
// ============================================================================

export interface CollectorConfig {
  rules: Rule[];
  plugins: Record<string, string>;
}
