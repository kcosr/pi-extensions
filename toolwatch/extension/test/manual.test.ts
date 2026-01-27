/**
 * Tests for manual approval.
 */

import { describe, it, expect, vi } from "vitest";
import type { ToolCallEvent } from "@pi-extensions/toolwatch-common";
import { manualApproval } from "../plugins/manual.js";

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

describe("manualApproval", () => {
  describe("without UI context", () => {
    it("denies when ctx is undefined", async () => {
      const result = await manualApproval(makeEvent(), undefined);

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("requires interactive UI");
    });

    it("denies when ctx.hasUI is false", async () => {
      const result = await manualApproval(makeEvent(), { hasUI: false });

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("requires interactive UI");
    });

    it("denies when ctx.hasUI is undefined", async () => {
      const result = await manualApproval(makeEvent(), {});

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("requires interactive UI");
    });
  });

  describe("with UI context", () => {
    it("returns approved when user confirms", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
        },
      };

      const result = await manualApproval(makeEvent(), ctx);

      expect(result.approved).toBe(true);
      expect(result.reason).toBeUndefined();
    });

    it("returns denied when user rejects", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(false),
        },
      };

      const result = await manualApproval(makeEvent(), ctx);

      expect(result.approved).toBe(false);
      expect(result.reason).toBe("Manually denied by user");
    });

    it("passes formatted message to confirm dialog", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
        },
      };
      const event = makeEvent({
        tool: "read",
        params: { path: "/etc/passwd" },
      });

      await manualApproval(event, ctx);

      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Manual Approval Required",
        expect.stringContaining("read")
      );
      expect(ctx.ui.confirm).toHaveBeenCalledWith(
        "Manual Approval Required",
        expect.stringContaining("/etc/passwd")
      );
    });

    it("filters out undefined params", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
        },
      };
      const event = makeEvent({
        tool: "read",
        params: { path: "/tmp/file", offset: undefined, limit: undefined },
      });

      await manualApproval(event, ctx);

      const message = ctx.ui.confirm.mock.calls[0][1];
      expect(message).toContain("path=/tmp/file");
      expect(message).not.toContain("offset");
      expect(message).not.toContain("limit");
    });

    it("truncates long param values", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
        },
      };
      const longValue = "x".repeat(200);
      const event = makeEvent({
        tool: "bash",
        params: { command: longValue },
      });

      await manualApproval(event, ctx);

      const message = ctx.ui.confirm.mock.calls[0][1];
      expect(message).toContain("x".repeat(100) + "...");
      expect(message).not.toContain("x".repeat(101));
    });

    it("handles empty params", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
        },
      };
      const event = makeEvent({ params: {} });

      await manualApproval(event, ctx);

      const message = ctx.ui.confirm.mock.calls[0][1];
      expect(message).toBe("bash: ");
    });

    it("handles null params", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockResolvedValue(true),
        },
      };
      const event = { ...makeEvent(), params: null as any };

      await manualApproval(event, ctx);

      const message = ctx.ui.confirm.mock.calls[0][1];
      expect(message).toContain("(no params)");
    });
  });

  describe("error handling", () => {
    it("returns denied when confirm throws", async () => {
      const ctx = {
        hasUI: true,
        ui: {
          confirm: vi.fn().mockRejectedValue(new Error("Dialog crashed")),
        },
      };

      const result = await manualApproval(makeEvent(), ctx);

      expect(result.approved).toBe(false);
      expect(result.reason).toContain("Approval dialog error");
      expect(result.reason).toContain("Dialog crashed");
    });
  });
});
