/**
 * Tests for collector server behavior.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../src/config.js", () => ({
  loadConfig: () => ({
    rules: [
      {
        match: { tool: "bash" },
        action: "deny",
        reason: "Bash is denied",
      },
      { action: "allow" },
    ],
    plugins: {},
  }),
}));

vi.mock("../plugins/manual.js", () => ({
  default: { evaluate: async () => ({ approved: false }) },
  initManualPlugin: vi.fn(),
  approve: vi.fn(),
  deny: vi.fn(),
  onPendingChange: vi.fn(),
}));

import { createServer } from "../src/server.js";
import { ToolwatchDB } from "../src/db.js";

const makeToolCallEvent = () => ({
  type: "tool_call" as const,
  ts: Date.now(),
  toolCallId: "audit-only-1",
  user: "testuser",
  hostname: "testhost",
  session: null,
  cwd: "/home/test",
  model: "claude",
  tool: "bash",
  params: { command: "sudo ls" },
});

describe("collector server", () => {
  let server: Server | undefined;
  let db: ToolwatchDB | undefined;
  let tempDir: string | undefined;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "toolwatch-server-test-"));
    const dbPath = path.join(tempDir, "toolwatch.db");
    db = new ToolwatchDB(dbPath);
    server = createServer(db, 0);
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.listen(0, () => resolve());
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      if (!server) {
        resolve();
        return;
      }
      server.close(() => resolve());
    });
    db?.close();
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("skips rule evaluation for audit-only tool_call events", async () => {
    if (!server) {
      throw new Error("Server not initialized");
    }
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://localhost:${address.port}/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Toolwatch-Audit": "true",
      },
      body: JSON.stringify(makeToolCallEvent()),
    });

    const result = await response.json();
    expect(result.approved).toBe(true);

    const calls = db?.query({ tool: "bash" }) ?? [];
    expect(calls).toHaveLength(1);
    expect(calls[0]?.approvalStatus).toBe("approved");
  });
});
