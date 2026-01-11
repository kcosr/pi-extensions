/**
 * Tests for database layer
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { ToolwatchDB } from "../src/db.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("ToolwatchDB", () => {
  let db: ToolwatchDB;
  let dbPath: string;

  beforeEach(() => {
    // Create temp DB for each test
    dbPath = path.join(os.tmpdir(), `toolwatch-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
    db = new ToolwatchDB(dbPath);
  });

  afterEach(() => {
    db.close();
    // Clean up test DB
    try {
      fs.unlinkSync(dbPath);
      fs.unlinkSync(dbPath + "-shm");
      fs.unlinkSync(dbPath + "-wal");
    } catch {
      // Ignore cleanup errors
    }
  });

  function insertTestCall(overrides: Record<string, unknown> = {}) {
    const toolCallId = `test-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    db.insertToolCall({
      toolCallId,
      ts: Date.now(),
      user: "testuser",
      hostname: "testhost",
      session: null,
      cwd: "/home/test",
      model: "claude-sonnet",
      tool: "bash",
      params: { command: "ls -la" },
      ...overrides,
    });
    return toolCallId;
  }

  describe("insertToolCall", () => {
    it("inserts a tool call", () => {
      const toolCallId = insertTestCall();
      const calls = db.query({ limit: 10 });
      expect(calls.length).toBe(1);
      expect(calls[0].toolCallId).toBe(toolCallId);
    });

    it("stores all fields correctly", () => {
      const ts = Date.now();
      insertTestCall({
        ts,
        user: "admin",
        hostname: "server1",
        session: "/path/to/session",
        cwd: "/var/www",
        model: "gpt-4",
        tool: "read",
        params: { path: "/etc/passwd" },
      });

      const calls = db.query({ limit: 10 });
      expect(calls[0].ts).toBe(ts);
      expect(calls[0].user).toBe("admin");
      expect(calls[0].hostname).toBe("server1");
      expect(calls[0].session).toBe("/path/to/session");
      expect(calls[0].cwd).toBe("/var/www");
      expect(calls[0].model).toBe("gpt-4");
      expect(calls[0].tool).toBe("read");
      expect(JSON.parse(calls[0].params)).toEqual({ path: "/etc/passwd" });
    });

    it("stores approval status", () => {
      insertTestCall({ approvalStatus: "pending" });
      const calls = db.query({ limit: 10 });
      expect(calls[0].approvalStatus).toBe("pending");
    });

    it("rejects duplicate toolCallId", () => {
      const toolCallId = "duplicate-id";
      insertTestCall({ toolCallId });
      expect(() => insertTestCall({ toolCallId })).toThrow();
    });
  });

  describe("updateToolResult", () => {
    it("updates result fields", () => {
      const toolCallId = insertTestCall();
      db.updateToolResult({
        toolCallId,
        ts: Date.now(),
        isError: false,
        durationMs: 150,
        exitCode: 0,
      });

      const calls = db.query({ limit: 10 });
      // SQLite stores booleans as 0/1
      expect(calls[0].isError).toBe(0);
      expect(calls[0].durationMs).toBe(150);
      expect(calls[0].exitCode).toBe(0);
    });

    it("records error status", () => {
      const toolCallId = insertTestCall();
      db.updateToolResult({
        toolCallId,
        ts: Date.now(),
        isError: true,
        durationMs: 50,
        exitCode: 1,
      });

      const calls = db.query({ limit: 10 });
      // SQLite stores booleans as 0/1
      expect(calls[0].isError).toBe(1);
      expect(calls[0].exitCode).toBe(1);
    });

    it("handles missing exitCode", () => {
      const toolCallId = insertTestCall();
      db.updateToolResult({
        toolCallId,
        ts: Date.now(),
        isError: false,
        durationMs: 100,
      });

      const calls = db.query({ limit: 10 });
      expect(calls[0].exitCode).toBeNull();
    });
  });

  describe("query", () => {
    beforeEach(() => {
      // Insert variety of test data
      insertTestCall({ user: "alice", tool: "bash", model: "claude" });
      insertTestCall({ user: "bob", tool: "read", model: "claude" });
      insertTestCall({ user: "alice", tool: "grep", model: "gpt-4" });
      insertTestCall({ user: "alice", tool: "bash", model: "gpt-4", approvalStatus: "approved" });
      insertTestCall({ user: "bob", tool: "bash", model: "claude", approvalStatus: "denied" });
    });

    it("returns all calls with no filter", () => {
      const calls = db.query({ limit: 100 });
      expect(calls.length).toBe(5);
    });

    it("filters by user", () => {
      const calls = db.query({ user: "alice", limit: 100 });
      expect(calls.length).toBe(3);
      expect(calls.every((c) => c.user === "alice")).toBe(true);
    });

    it("filters by tool", () => {
      const calls = db.query({ tool: "bash", limit: 100 });
      expect(calls.length).toBe(3);
      expect(calls.every((c) => c.tool === "bash")).toBe(true);
    });

    it("filters by model", () => {
      const calls = db.query({ model: "claude", limit: 100 });
      expect(calls.length).toBe(3);
      expect(calls.every((c) => c.model === "claude")).toBe(true);
    });

    it("filters by approval status", () => {
      const approved = db.query({ approvalStatus: "approved", limit: 100 });
      expect(approved.length).toBe(1);
      expect(approved[0].approvalStatus).toBe("approved");

      const denied = db.query({ approvalStatus: "denied", limit: 100 });
      expect(denied.length).toBe(1);
      expect(denied[0].approvalStatus).toBe("denied");
    });

    it("filters by isError", () => {
      // Update one call to have error
      const toolCallId = insertTestCall();
      db.updateToolResult({ toolCallId, ts: Date.now(), isError: true, durationMs: 10 });

      const errors = db.query({ isError: true, limit: 100 });
      expect(errors.length).toBe(1);
      // SQLite stores booleans as 0/1
      expect(errors[0].isError).toBe(1);
    });

    it("searches in params", () => {
      insertTestCall({ params: { command: "cat /etc/shadow" } });
      const calls = db.query({ search: "shadow", limit: 100 });
      expect(calls.length).toBe(1);
      expect(calls[0].params).toContain("shadow");
    });

    it("combines multiple filters (AND)", () => {
      const calls = db.query({ user: "alice", tool: "bash", limit: 100 });
      expect(calls.length).toBe(2);
      expect(calls.every((c) => c.user === "alice" && c.tool === "bash")).toBe(true);
    });

    it("respects limit", () => {
      const calls = db.query({ limit: 2 });
      expect(calls.length).toBe(2);
    });

    it("respects offset", () => {
      const all = db.query({ limit: 100 });
      const offset = db.query({ limit: 100, offset: 2 });
      expect(offset.length).toBe(all.length - 2);
    });

    it("orders by ts descending", () => {
      const calls = db.query({ limit: 100 });
      for (let i = 1; i < calls.length; i++) {
        expect(calls[i - 1].ts).toBeGreaterThanOrEqual(calls[i].ts);
      }
    });

    it("filters by time range", () => {
      const now = Date.now();
      insertTestCall({ ts: now - 10000 }); // 10s ago
      insertTestCall({ ts: now - 5000 });  // 5s ago
      insertTestCall({ ts: now });          // now

      const calls = db.query({ from: now - 7000, to: now - 3000, limit: 100 });
      expect(calls.length).toBe(1);
    });
  });

  describe("getUsers/getTools/getModels", () => {
    beforeEach(() => {
      insertTestCall({ user: "alice", tool: "bash", model: "claude" });
      insertTestCall({ user: "bob", tool: "read", model: "gpt-4" });
      insertTestCall({ user: "alice", tool: "grep", model: "claude" });
    });

    it("returns distinct users", () => {
      const users = db.getUsers();
      expect(users).toEqual(["alice", "bob"]);
    });

    it("returns distinct tools", () => {
      const tools = db.getTools();
      expect(tools).toEqual(["bash", "grep", "read"]);
    });

    it("returns distinct models", () => {
      const models = db.getModels();
      expect(models).toEqual(["claude", "gpt-4"]);
    });
  });

  describe("getStats", () => {
    it("returns correct statistics", () => {
      insertTestCall({ user: "alice", tool: "bash" });
      insertTestCall({ user: "bob", tool: "read" });
      insertTestCall({ user: "alice", tool: "grep" });

      // Add an error (uses default "testuser")
      const errorId = insertTestCall({ user: "alice" });
      db.updateToolResult({ toolCallId: errorId, ts: Date.now(), isError: true, durationMs: 10 });

      const stats = db.getStats();
      expect(stats.total).toBe(4);
      expect(stats.users).toBe(2); // alice and bob
      expect(stats.tools).toBe(3); // bash, read, grep (error call also uses bash by default)
      expect(stats.errors).toBe(1);
    });

    it("returns zeros for empty database", () => {
      const stats = db.getStats();
      expect(stats.total).toBe(0);
      expect(stats.users).toBe(0);
      expect(stats.tools).toBe(0);
      // SUM returns null for empty table, not 0
      expect(stats.errors).toBeNull();
    });
  });

  describe("approval methods", () => {
    it("getPendingApprovals returns pending calls", () => {
      insertTestCall({ approvalStatus: "pending" });
      insertTestCall({ approvalStatus: "pending" });
      insertTestCall({ approvalStatus: "approved" });
      insertTestCall({ approvalStatus: "denied" });
      insertTestCall({ approvalStatus: null });

      const pending = db.getPendingApprovals();
      expect(pending.length).toBe(2);
      expect(pending.every((c) => c.approvalStatus === "pending")).toBe(true);
    });

    it("getPendingApprovals orders by ts ascending (oldest first)", () => {
      const now = Date.now();
      insertTestCall({ ts: now + 100, approvalStatus: "pending" });
      insertTestCall({ ts: now, approvalStatus: "pending" });
      insertTestCall({ ts: now + 50, approvalStatus: "pending" });

      const pending = db.getPendingApprovals();
      expect(pending[0].ts).toBe(now);
      expect(pending[1].ts).toBe(now + 50);
      expect(pending[2].ts).toBe(now + 100);
    });

    it("getApprovalStatus returns status and reason", () => {
      const toolCallId = insertTestCall({ approvalStatus: "denied" });
      db.updateApprovalStatus(toolCallId, "denied", "Not allowed");

      // Need to re-insert since we already inserted with denied
      const toolCallId2 = insertTestCall({ approvalStatus: "pending" });
      db.updateApprovalStatus(toolCallId2, "denied", "Custom reason");

      const status = db.getApprovalStatus(toolCallId2);
      expect(status?.status).toBe("denied");
      expect(status?.reason).toBe("Custom reason");
    });

    it("getApprovalStatus returns undefined for non-existent call", () => {
      const status = db.getApprovalStatus("nonexistent");
      expect(status).toBeUndefined();
    });

    it("updateApprovalStatus approves pending call", () => {
      const toolCallId = insertTestCall({ approvalStatus: "pending" });
      const success = db.updateApprovalStatus(toolCallId, "approved");

      expect(success).toBe(true);
      const status = db.getApprovalStatus(toolCallId);
      expect(status?.status).toBe("approved");
    });

    it("updateApprovalStatus denies pending call with reason", () => {
      const toolCallId = insertTestCall({ approvalStatus: "pending" });
      const success = db.updateApprovalStatus(toolCallId, "denied", "Too dangerous");

      expect(success).toBe(true);
      const status = db.getApprovalStatus(toolCallId);
      expect(status?.status).toBe("denied");
      expect(status?.reason).toBe("Too dangerous");
    });

    it("updateApprovalStatus only updates pending calls", () => {
      const toolCallId = insertTestCall({ approvalStatus: "approved" });
      const success = db.updateApprovalStatus(toolCallId, "denied");

      expect(success).toBe(false);
      const status = db.getApprovalStatus(toolCallId);
      expect(status?.status).toBe("approved"); // Unchanged
    });

    it("updateApprovalStatus returns false for non-existent call", () => {
      const success = db.updateApprovalStatus("nonexistent", "approved");
      expect(success).toBe(false);
    });
  });
});
