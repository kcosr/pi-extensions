/**
 * Tests for audit logging.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import fs from "node:fs";
import type { ToolCallEvent, ToolResultEvent, Config } from "@pi-extensions/toolwatch-common";

vi.mock("node:fs");

import { sendAuditEvent } from "../src/audit.js";

function makeToolCallEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    type: "tool_call",
    ts: Date.now(),
    toolCallId: "test-123",
    user: "testuser",
    hostname: "testhost",
    session: null,
    cwd: "/home/test",
    model: "test-model",
    tool: "bash",
    params: { command: "ls -la" },
    ...overrides,
  };
}

function makeToolResultEvent(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    type: "tool_result",
    ts: Date.now(),
    toolCallId: "test-123",
    isError: false,
    durationMs: 100,
    ...overrides,
  };
}

function makeConfig(audit: Config["audit"]): Config {
  return {
    rules: { mode: "none" },
    audit,
    tools: [],
  };
}

describe("sendAuditEvent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
    vi.mocked(fs.appendFile).mockImplementation((path, data, callback) => {
      if (typeof callback === "function") callback(null);
    });
  });

  describe("mode: none", () => {
    it("does nothing", () => {
      const config = makeConfig({ mode: "none" });
      sendAuditEvent(makeToolCallEvent(), config);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(fs.appendFile).not.toHaveBeenCalled();
    });
  });

  describe("mode: file", () => {
    it("writes event to file", () => {
      const config = makeConfig({
        mode: "file",
        file: { path: "/tmp/audit.jsonl" },
      });
      const event = makeToolCallEvent();

      sendAuditEvent(event, config);

      expect(fs.appendFile).toHaveBeenCalledWith(
        "/tmp/audit.jsonl",
        JSON.stringify(event) + "\n",
        expect.any(Function)
      );
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it("does nothing if path not configured", () => {
      const config = makeConfig({ mode: "file" });
      sendAuditEvent(makeToolCallEvent(), config);

      expect(fs.appendFile).not.toHaveBeenCalled();
    });
  });

  describe("mode: http", () => {
    it("sends event via HTTP", () => {
      const config = makeConfig({
        mode: "http",
        http: { url: "http://localhost:9999/events" },
      });
      const event = makeToolCallEvent();

      sendAuditEvent(event, config);

      expect(global.fetch).toHaveBeenCalledWith(
        "http://localhost:9999/events",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Toolwatch-Audit": "true",
          },
          body: JSON.stringify(event),
        })
      );
      expect(fs.appendFile).not.toHaveBeenCalled();
    });

    it("does nothing if url not configured", () => {
      const config = makeConfig({ mode: "http" });
      sendAuditEvent(makeToolCallEvent(), config);

      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("mode: both", () => {
    it("writes to file AND sends via HTTP", () => {
      const config = makeConfig({
        mode: "both",
        http: { url: "http://localhost:9999/events" },
        file: { path: "/tmp/audit.jsonl" },
      });
      const event = makeToolCallEvent();

      sendAuditEvent(event, config);

      expect(global.fetch).toHaveBeenCalled();
      expect(fs.appendFile).toHaveBeenCalled();
    });
  });

  describe("mode: http-with-fallback", () => {
    it("sends via HTTP when successful", async () => {
      vi.mocked(global.fetch).mockResolvedValue({ ok: true } as Response);

      const config = makeConfig({
        mode: "http-with-fallback",
        http: { url: "http://localhost:9999/events" },
        file: { path: "/tmp/fallback.jsonl" },
      });

      sendAuditEvent(makeToolCallEvent(), config);

      expect(global.fetch).toHaveBeenCalled();
      // File not written immediately (only on failure)
    });

    it("writes to file when HTTP fails", async () => {
      vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

      const config = makeConfig({
        mode: "http-with-fallback",
        http: { url: "http://localhost:9999/events" },
        file: { path: "/tmp/fallback.jsonl" },
      });
      const event = makeToolCallEvent();

      sendAuditEvent(event, config);

      // Wait for the promise chain to complete
      await new Promise((r) => setTimeout(r, 10));

      expect(fs.appendFile).toHaveBeenCalledWith(
        "/tmp/fallback.jsonl",
        JSON.stringify(event) + "\n",
        expect.any(Function)
      );
    });

    it("writes to file when url not configured", () => {
      const config = makeConfig({
        mode: "http-with-fallback",
        file: { path: "/tmp/fallback.jsonl" },
      });
      const event = makeToolCallEvent();

      sendAuditEvent(event, config);

      expect(fs.appendFile).toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });
  });

  describe("event types", () => {
    it("handles tool_call events", () => {
      const config = makeConfig({
        mode: "file",
        file: { path: "/tmp/audit.jsonl" },
      });
      const event = makeToolCallEvent({ tool: "read", params: { path: "/etc/passwd" } });

      sendAuditEvent(event, config);

      const written = vi.mocked(fs.appendFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed.type).toBe("tool_call");
      expect(parsed.tool).toBe("read");
      expect(parsed.params.path).toBe("/etc/passwd");
    });

    it("handles tool_result events", () => {
      const config = makeConfig({
        mode: "file",
        file: { path: "/tmp/audit.jsonl" },
      });
      const event = makeToolResultEvent({ isError: true, durationMs: 500, exitCode: 1 });

      sendAuditEvent(event, config);

      const written = vi.mocked(fs.appendFile).mock.calls[0][1] as string;
      const parsed = JSON.parse(written.trim());
      expect(parsed.type).toBe("tool_result");
      expect(parsed.isError).toBe(true);
      expect(parsed.durationMs).toBe(500);
      expect(parsed.exitCode).toBe(1);
    });
  });
});
