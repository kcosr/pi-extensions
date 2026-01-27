/**
 * Toolwatch Common - Shared types and utilities for toolwatch extension and collector.
 */

// Types
export type {
  ToolCallEvent,
  ToolResultEvent,
  ToolwatchEvent,
  ApprovalResponse,
  MatchValue,
  MatchCondition,
  Rule,
  ApprovalPlugin,
  RulesConfig,
  AuditConfig,
  Config,
  CollectorConfig,
} from "./types.js";

// Rules evaluation
export { findMatchingRule, evaluateRules, type RulesResult } from "./rules.js";

// Plugin loading
export {
  registerPlugin,
  getPlugin,
  hasPlugin,
  loadPlugin,
  clearPluginCache,
  getRegisteredPlugins,
} from "./plugin-loader.js";
