/**
 * Toolwatch Extension
 *
 * Captures tool calls and results for auditing and policy enforcement.
 * Supports local and remote rules evaluation with configurable audit logging.
 *
 * Note: Types from @mariozechner/pi-coding-agent are resolved at runtime via pi's jiti loader.
 * TypeScript type checking is disabled for these imports.
 */

import os from "node:os";
// @ts-ignore - types provided at runtime by pi
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
// @ts-ignore - types provided at runtime by pi
import { isBashToolResult } from "@mariozechner/pi-coding-agent";
import type { ToolCallEvent, ToolResultEvent } from "@pi-extensions/toolwatch-common";

import { loadConfig } from "./src/config.js";
import { evaluateLocal, evaluateRemote } from "./src/evaluator.js";
import { sendAuditEvent } from "./src/audit.js";
import { getUser, filterParams } from "./src/utils.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const user = getUser();
  const hostname = os.hostname();

  // Track call timestamps for duration calculation
  const callTimestamps = new Map<string, number>();

  // Check if tool should be processed
  function shouldProcess(toolName: string): boolean {
    return config.tools.length === 0 || config.tools.includes(toolName);
  }

  // Get audit URL for remote rules
  function getAuditUrl(): string | undefined {
    return config.audit.http?.url;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pi.on("tool_call", async (event: any, ctx: any) => {
    if (!shouldProcess(event.toolName)) return undefined;

    const ts = Date.now();
    callTimestamps.set(event.toolCallId, ts);

    const toolCallEvent: ToolCallEvent = {
      type: "tool_call",
      ts,
      toolCallId: event.toolCallId,
      user,
      hostname,
      session: ctx.sessionManager.getSessionFile() ?? null,
      cwd: ctx.cwd,
      model: ctx.model?.id ?? "unknown",
      tool: event.toolName,
      params: filterParams(event.toolName, event.input),
    };

    // Evaluate rules based on mode
    const rulesMode = config.rules.mode;

    if (rulesMode === "local") {
      // Local rules evaluation
      const approval = await evaluateLocal(toolCallEvent, config, ctx);

      // Send audit event (async)
      sendAuditEvent(toolCallEvent, config);

      if (!approval.approved) {
        return { block: true, reason: approval.reason ?? "Blocked by toolwatch policy" };
      }
      return undefined;
    }

    if (rulesMode === "remote") {
      // Remote rules evaluation (sync HTTP to collector)
      const auditUrl = getAuditUrl();
      if (!auditUrl) {
        console.error("[toolwatch] Remote rules mode requires audit.http.url");
        return { block: true, reason: "Remote rules not configured" };
      }

      const approval = await evaluateRemote(toolCallEvent, config, auditUrl);
      const auditFailed = approval.auditFailed === true;

      // Also write to local file if configured (collector handles HTTP audit)
      const shouldWriteFile =
        config.audit.mode === "file" ||
        config.audit.mode === "both" ||
        (config.audit.mode === "http-with-fallback" && auditFailed);

      if (shouldWriteFile) {
        sendAuditEvent({ ...toolCallEvent }, { ...config, audit: { ...config.audit, mode: "file" } });
      }

      if (!approval.approved) {
        return { block: true, reason: approval.reason ?? "Blocked by toolwatch policy" };
      }
      return undefined;
    }

    // rules.mode === "none" - just audit, no blocking
    sendAuditEvent(toolCallEvent, config);
    return undefined;
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pi.on("tool_result", async (event: any) => {
    if (!shouldProcess(event.toolName)) return undefined;

    const ts = Date.now();
    const callTs = callTimestamps.get(event.toolCallId);
    callTimestamps.delete(event.toolCallId);

    const toolResultEvent: ToolResultEvent = {
      type: "tool_result",
      ts,
      toolCallId: event.toolCallId,
      isError: event.isError,
      durationMs: callTs ? ts - callTs : -1,
      ...(isBashToolResult(event) && event.details?.exitCode !== undefined
        ? { exitCode: event.details.exitCode }
        : {}),
    };

    // Results are always async (no approval needed)
    sendAuditEvent(toolResultEvent, config);
    return undefined;
  });
}
