/**
 * Tests for rules evaluation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ToolCallEvent, Config, ApprovalPlugin } from "@pi-extensions/toolwatch-common";

// Mock the manual approval module
vi.mock("../plugins/manual.js", () => ({
  manualApproval: vi.fn(),
}));

// Mock the config module
vi.mock("../src/config.js", () => ({
  getExtensionDir: () => "/mock/extension",
}));

// Mock plugin-loader from common
vi.mock("@pi-extensions/toolwatch-common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pi-extensions/toolwatch-common")>();
  return {
    ...actual,
    loadPlugin: vi.fn(),
  };
});

import { evaluateLocal, evaluateRemote } from "../src/evaluator.js";
import { manualApproval } from "../plugins/manual.js";
import { loadPlugin } from "@pi-extensions/toolwatch-common";

function makeEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
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

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    rules: { mode: "local", rules: [] },
    audit: { mode: "none" },
    tools: [],
    ...overrides,
  };
}

describe("evaluateLocal", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("allow/deny rules", () => {
    it("returns approved=true when no rules (default allow)", async () => {
      const config = makeConfig({ rules: { mode: "local", rules: [] } });
      const result = await evaluateLocal(makeEvent(), config, {});

      expect(result.approved).toBe(true);
    });

    it("returns approved=true for matching allow rule", async () => {
      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ match: { tool: "bash" }, action: "allow" }],
        },
      });
      const result = await evaluateLocal(makeEvent({ tool: "bash" }), config, {});

      expect(result.approved).toBe(true);
    });

    it("returns approved=false for matching deny rule", async () => {
      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ match: { tool: "bash" }, action: "deny", reason: "No bash" }],
        },
      });
      const result = await evaluateLocal(makeEvent({ tool: "bash" }), config, {});

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("No bash");
    });

    it("returns first matching rule", async () => {
      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [
            { match: { tool: "bash" }, action: "deny", reason: "Denied" },
            { match: { tool: "bash" }, action: "allow" },
          ],
        },
      });
      const result = await evaluateLocal(makeEvent({ tool: "bash" }), config, {});

      expect(result.approved).toBe(false);
    });

    it("skips non-matching rules", async () => {
      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [
            { match: { tool: "read" }, action: "deny" },
            { action: "allow" },
          ],
        },
      });
      const result = await evaluateLocal(makeEvent({ tool: "bash" }), config, {});

      expect(result.approved).toBe(true);
    });
  });

  describe("manual action", () => {
    it("calls manualApproval for action: manual", async () => {
      vi.mocked(manualApproval).mockResolvedValue({ approved: true });

      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ match: { tool: "bash" }, action: "manual" }],
        },
      });
      const ctx = { hasUI: true };
      const event = makeEvent({ tool: "bash" });

      const result = await evaluateLocal(event, config, ctx);

      expect(manualApproval).toHaveBeenCalledWith(event, ctx);
      expect(result.approved).toBe(true);
    });

    it("returns manual denial", async () => {
      vi.mocked(manualApproval).mockResolvedValue({
        approved: false,
        reason: "Manually denied by user",
      });

      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ action: "manual" }],
        },
      });
      const result = await evaluateLocal(makeEvent(), config, {});

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("Manually denied by user");
    });
  });

  describe("plugin action", () => {
    it("loads and invokes plugin", async () => {
      const mockPlugin: ApprovalPlugin = {
        evaluate: vi.fn().mockResolvedValue({ approved: true, reason: "Plugin approved" }),
      };
      vi.mocked(loadPlugin).mockResolvedValue(mockPlugin);

      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ action: "plugin", plugin: "my-plugin" }],
          plugins: { "my-plugin": "./plugins/my-plugin.ts" },
        },
      });
      const ctx = { custom: "context" };
      const event = makeEvent();

      const result = await evaluateLocal(event, config, ctx);

      expect(loadPlugin).toHaveBeenCalledWith("my-plugin", "./plugins/my-plugin.ts", "/mock/extension");
      expect(mockPlugin.evaluate).toHaveBeenCalledWith(event, ctx);
      expect(result.approved).toBe(true);
    });

    it("returns denied when plugin not found", async () => {
      vi.mocked(loadPlugin).mockResolvedValue(undefined);

      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ action: "plugin", plugin: "missing-plugin" }],
        },
      });
      const result = await evaluateLocal(makeEvent(), config, {});

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("Plugin not found");
    });

    it("returns denied when plugin throws", async () => {
      const mockPlugin: ApprovalPlugin = {
        evaluate: vi.fn().mockRejectedValue(new Error("Plugin crashed")),
      };
      vi.mocked(loadPlugin).mockResolvedValue(mockPlugin);

      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [{ action: "plugin", plugin: "bad-plugin" }],
          plugins: { "bad-plugin": "./plugins/bad.ts" },
        },
      });
      const result = await evaluateLocal(makeEvent(), config, {});

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("Plugin error");
    });
  });

  describe("regex matching", () => {
    it("matches regex patterns in params", async () => {
      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [
            { match: { "params.command": "/sudo/" }, action: "deny", reason: "No sudo" },
            { action: "allow" },
          ],
        },
      });

      const sudoResult = await evaluateLocal(
        makeEvent({ params: { command: "sudo rm -rf /" } }),
        config,
        {}
      );
      expect(sudoResult.approved).toBe(false);

      const lsResult = await evaluateLocal(
        makeEvent({ params: { command: "ls -la" } }),
        config,
        {}
      );
      expect(lsResult.approved).toBe(true);
    });

    it("matches array of patterns (OR)", async () => {
      const config = makeConfig({
        rules: {
          mode: "local",
          rules: [
            {
              match: { "params.command": ["/sudo/", "/rm\\s+-rf/"] },
              action: "deny",
            },
            { action: "allow" },
          ],
        },
      });

      const sudo = await evaluateLocal(makeEvent({ params: { command: "sudo ls" } }), config, {});
      expect(sudo.approved).toBe(false);

      const rm = await evaluateLocal(makeEvent({ params: { command: "rm -rf /tmp" } }), config, {});
      expect(rm.approved).toBe(false);

      const ls = await evaluateLocal(makeEvent({ params: { command: "ls" } }), config, {});
      expect(ls.approved).toBe(true);
    });
  });
});

describe("evaluateRemote", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    global.fetch = vi.fn();
  });

  it("sends event to remote URL and returns response", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ approved: true }),
    } as Response);

    const config = makeConfig({ rules: { mode: "remote" } });
    const event = makeEvent();

    const result = await evaluateRemote(event, config, "http://localhost:9999/events");

    expect(global.fetch).toHaveBeenCalledWith(
      "http://localhost:9999/events",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
      })
    );
    expect(result.approved).toBe(true);
    expect(result.auditFailed).toBe(false);
  });

  it("returns denied on HTTP error with errorAction: block", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const config = makeConfig({
      rules: { mode: "remote", errorAction: "block" },
    });
    const result = await evaluateRemote(makeEvent(), config, "http://localhost:9999/events");

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("HTTP 500");
    expect(result.auditFailed).toBe(true);
  });

  it("returns approved on HTTP error with errorAction: allow", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);

    const config = makeConfig({
      rules: { mode: "remote", errorAction: "allow" },
    });
    const result = await evaluateRemote(makeEvent(), config, "http://localhost:9999/events");

    expect(result.approved).toBe(true);
    expect(result.auditFailed).toBe(true);
  });

  it("returns denied on network error with errorAction: block", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Network error"));

    const config = makeConfig({
      rules: { mode: "remote", errorAction: "block" },
    });
    const result = await evaluateRemote(makeEvent(), config, "http://localhost:9999/events");

    expect(result.approved).toBe(false);
    expect(result.reason).toContain("Network error");
    expect(result.auditFailed).toBe(true);
  });

  it("defaults to block on error when errorAction not specified", async () => {
    vi.mocked(global.fetch).mockRejectedValue(new Error("Failed"));

    const config = makeConfig({ rules: { mode: "remote" } });
    const result = await evaluateRemote(makeEvent(), config, "http://localhost:9999/events");

    expect(result.approved).toBe(false);
    expect(result.auditFailed).toBe(true);
  });

  it("handles timeout with AbortError", async () => {
    const abortError = new Error("Aborted");
    abortError.name = "AbortError";
    vi.mocked(global.fetch).mockRejectedValue(abortError);

    const config = makeConfig({
      rules: { mode: "remote", timeoutMs: 1000, errorAction: "block" },
    });
    const result = await evaluateRemote(makeEvent(), config, "http://localhost:9999/events");

    expect(result.approved).toBe(false);
    expect(result.reason).toBe("Approval timeout");
    expect(result.auditFailed).toBe(true);
  });
});
