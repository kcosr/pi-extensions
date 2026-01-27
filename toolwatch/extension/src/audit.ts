/**
 * Audit logging for tool calls.
 * Handles file and HTTP logging modes.
 */

import fs from "node:fs";
import type { ToolwatchEvent, Config } from "@pi-extensions/toolwatch-common";

// Mark audit-only requests so the collector logs without rule evaluation.
const auditHeaders = {
  "Content-Type": "application/json",
  "X-Toolwatch-Audit": "true",
};

/**
 * Send audit event to configured destinations (async, fire-and-forget).
 */
export function sendAuditEvent(event: ToolwatchEvent, config: Config): void {
  const payload = JSON.stringify(event);
  const mode = config.audit.mode;

  if (mode === "none") return;

  if (mode === "http") {
    sendHttp(config.audit.http?.url, payload);
  } else if (mode === "file") {
    writeFile(config.audit.file?.path, payload);
  } else if (mode === "both") {
    sendHttp(config.audit.http?.url, payload);
    writeFile(config.audit.file?.path, payload);
  } else if (mode === "http-with-fallback") {
    sendHttpWithFallback(config.audit.http?.url, config.audit.file?.path, payload);
  }
}

/**
 * Send HTTP request (fire and forget).
 */
function sendHttp(url: string | undefined, payload: string): void {
  if (!url) return;

  fetch(url, {
    method: "POST",
    headers: auditHeaders,
    body: payload,
  }).catch(() => {
    // Silently ignore HTTP errors for audit
  });
}

/**
 * Write to file (fire and forget).
 */
function writeFile(filePath: string | undefined, payload: string): void {
  if (!filePath) return;

  fs.appendFile(filePath, payload + "\n", () => {
    // Silently ignore write errors for audit
  });
}

/**
 * Send HTTP with file fallback on failure.
 */
function sendHttpWithFallback(
  url: string | undefined,
  fallbackPath: string | undefined,
  payload: string
): void {
  if (!url) {
    writeFile(fallbackPath, payload);
    return;
  }

  fetch(url, {
    method: "POST",
    headers: auditHeaders,
    body: payload,
  }).catch(() => {
    writeFile(fallbackPath, payload);
  });
}
