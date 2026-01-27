/**
 * Re-export shared types from common module.
 * Collector-specific types are defined here.
 */

// Re-export all common types
export type {
  ToolCallEvent,
  ToolResultEvent,
  ToolwatchEvent,
  ApprovalResponse,
  MatchValue,
  MatchCondition,
  Rule,
  ApprovalPlugin,
  CollectorConfig as Config,
} from "@pi-extensions/toolwatch-common";
