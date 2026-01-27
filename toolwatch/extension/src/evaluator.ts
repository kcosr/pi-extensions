/**
 * Rules evaluator for the extension.
 * Handles local and remote rules evaluation.
 */

import {
  evaluateRules,
  loadPlugin,
  type ToolCallEvent,
  type ApprovalResponse,
  type Config,
} from "@pi-extensions/toolwatch-common";
import { getExtensionDir } from "./config.js";
import { manualApproval } from "../plugins/manual.js";

export interface RemoteEvaluationResult extends ApprovalResponse {
  auditFailed?: boolean;
}

// Extension context type (from pi-coding-agent)
// We use unknown here to avoid direct dependency
type ExtensionContext = unknown;

/**
 * Evaluate a tool call against local rules.
 */
export async function evaluateLocal(
  event: ToolCallEvent,
  config: Config,
  ctx: ExtensionContext
): Promise<ApprovalResponse> {
  const rules = config.rules.rules ?? [];
  const result = evaluateRules(event, rules);

  // Manual approval required
  if (result.requiresManual) {
    return manualApproval(event, ctx);
  }

  // Plugin required
  if (result.pluginName) {
    const pluginPath = config.rules.plugins?.[result.pluginName];
    const plugin = await loadPlugin(result.pluginName, pluginPath, getExtensionDir());

    if (!plugin) {
      return { approved: false, reason: `Plugin not found: ${result.pluginName}` };
    }

    try {
      return await plugin.evaluate(event, ctx);
    } catch (err) {
      console.error(`[toolwatch] Plugin ${result.pluginName} threw error:`, err);
      return { approved: false, reason: `Plugin error: ${err}` };
    }
  }

  // Immediate response (allow/deny)
  return result.response;
}

/**
 * Evaluate a tool call against remote rules (via HTTP to collector).
 */
export async function evaluateRemote(
  event: ToolCallEvent,
  config: Config,
  auditUrl: string
): Promise<RemoteEvaluationResult> {
  const timeoutMs = config.rules.timeoutMs;
  const errorAction = config.rules.errorAction ?? "block";

  try {
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    // Only set timeout if timeoutMs > 0
    if (timeoutMs && timeoutMs > 0) {
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    }

    const response = await fetch(auditUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      signal: controller.signal,
    });

    if (timeoutId) clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const approval = (await response.json()) as ApprovalResponse;
    return { ...approval, auditFailed: false };
  } catch (err) {
    const isTimeout = err instanceof Error && err.name === "AbortError";
    const reason = isTimeout ? "Approval timeout" : `Approval error: ${err}`;

    return {
      approved: errorAction === "allow",
      reason,
      auditFailed: true,
    };
  }
}
