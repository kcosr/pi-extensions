/**
 * Telemetry Extension
 *
 * Captures tool calls and results for auditing.
 * Supports HTTP, file (JSONL), or both with configurable modes.
 * Supports sync mode for approval workflows.
 */

import fs from "node:fs";
import os from "node:os";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isBashToolResult } from "@mariozechner/pi-coding-agent";
import {
  loadConfig,
  getUser,
  filterParams,
  type Config,
  type TelemetryEvent,
  type ToolCallEvent,
  type ToolResultEvent,
  type ApprovalResponse,
} from "./lib.js";

export default function (pi: ExtensionAPI) {
  const config = loadConfig();
  const user = getUser();
  const hostname = os.hostname();

  // Track call timestamps for duration calculation
  const callTimestamps = new Map<string, number>();

  // Send event (async, fire-and-forget)
  function sendEventAsync(event: TelemetryEvent): void {
    const payload = JSON.stringify(event);

    switch (config.mode) {
      case "http":
        sendHttpAsync(config, payload);
        break;

      case "file":
        writeFile(config, payload);
        break;

      case "both":
        sendHttpAsync(config, payload);
        writeFile(config, payload);
        break;

      case "http-with-fallback":
        sendHttpWithFallback(config, payload);
        break;
    }
  }

  // Send event (sync, wait for approval response)
  async function sendEventSync(event: ToolCallEvent): Promise<ApprovalResponse> {
    const payload = JSON.stringify(event);

    // Only HTTP modes support sync
    if (config.mode === "file") {
      writeFile(config, payload);
      return { approved: true };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), config.http.timeoutMs);

      const response = await fetch(config.http.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const result = (await response.json()) as ApprovalResponse;
      return result;
    } catch (err) {
      // On timeout or error, apply timeoutAction
      if (config.mode === "http-with-fallback" || config.mode === "both") {
        writeFile(config, payload);
      }

      const isTimeout = err instanceof Error && err.name === "AbortError";
      const reason = isTimeout ? "Approval timeout" : `Approval error: ${err}`;

      return {
        approved: config.http.timeoutAction === "allow",
        reason,
      };
    }
  }

  // Check if tool should be audited
  function shouldAudit(toolName: string): boolean {
    return config.tools.length === 0 || config.tools.includes(toolName);
  }

  pi.on("tool_call", async (event, ctx) => {
    if (!shouldAudit(event.toolName)) return undefined;

    const ts = Date.now();
    callTimestamps.set(event.toolCallId, ts);

    const telemetryEvent: ToolCallEvent = {
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

    // Sync mode: wait for approval
    if (config.http.sync && config.mode !== "file") {
      const approval = await sendEventSync(telemetryEvent);
      if (!approval.approved) {
        return { block: true, reason: approval.reason ?? "Blocked by telemetry policy" };
      }
      return undefined;
    }

    // Async mode: fire and forget
    sendEventAsync(telemetryEvent);
    return undefined;
  });

  pi.on("tool_result", async (event) => {
    if (!shouldAudit(event.toolName)) return undefined;

    const ts = Date.now();
    const callTs = callTimestamps.get(event.toolCallId);
    callTimestamps.delete(event.toolCallId);

    const telemetryEvent: ToolResultEvent = {
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
    sendEventAsync(telemetryEvent);
    return undefined;
  });
}

// HTTP send (fire and forget)
function sendHttpAsync(config: Config, payload: string): void {
  fetch(config.http.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch(() => {
    // Silently ignore HTTP errors
  });
}

// File write (fire and forget)
function writeFile(config: Config, payload: string): void {
  fs.appendFile(config.file.path, payload + "\n", () => {
    // Silently ignore write errors
  });
}

// HTTP with file fallback
function sendHttpWithFallback(config: Config, payload: string): void {
  fetch(config.http.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: payload,
  }).catch(() => {
    writeFile(config, payload);
  });
}
