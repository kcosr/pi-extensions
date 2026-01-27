/**
 * Tests for config loading and legacy conversion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// We need to mock fs before importing the config module
vi.mock("node:fs");

// Mock import.meta.url for __dirname calculation
const mockConfigDir = "/mock/extension";

describe("config loading", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // Helper to create a test config module with mocked fs
  async function loadConfigWithMock(configContent: object | null) {
    vi.mocked(fs.readFileSync).mockImplementation((filePath) => {
      if (configContent === null) {
        throw new Error("ENOENT");
      }
      return JSON.stringify(configContent);
    });

    // Re-import to get fresh module with mocked fs
    const { loadConfig } = await import("../src/config.js");
    return loadConfig();
  }

  describe("new config format", () => {
    it("loads local rules config", async () => {
      const config = await loadConfigWithMock({
        rules: {
          mode: "local",
          rules: [{ action: "allow" }],
        },
        audit: { mode: "none" },
        tools: [],
      });

      expect(config.rules.mode).toBe("local");
      expect(config.rules.rules).toEqual([{ action: "allow" }]);
      expect(config.audit.mode).toBe("none");
      expect(config.tools).toEqual([]);
    });

    it("loads remote rules config", async () => {
      const config = await loadConfigWithMock({
        rules: {
          mode: "remote",
          timeoutMs: 30000,
          errorAction: "block",
        },
        audit: {
          mode: "http",
          http: { url: "http://localhost:9999/events" },
        },
        tools: ["bash"],
      });

      expect(config.rules.mode).toBe("remote");
      expect(config.rules.timeoutMs).toBe(30000);
      expect(config.rules.errorAction).toBe("block");
      expect(config.audit.mode).toBe("http");
      expect(config.audit.http?.url).toBe("http://localhost:9999/events");
    });

    it("loads audit-only config (rules: none)", async () => {
      const config = await loadConfigWithMock({
        rules: { mode: "none" },
        audit: {
          mode: "file",
          file: { path: "/tmp/audit.jsonl" },
        },
        tools: ["bash", "read"],
      });

      expect(config.rules.mode).toBe("none");
      expect(config.audit.mode).toBe("file");
      expect(config.audit.file?.path).toBe("/tmp/audit.jsonl");
    });

    it("loads http-with-fallback audit mode", async () => {
      const config = await loadConfigWithMock({
        rules: { mode: "none" },
        audit: {
          mode: "http-with-fallback",
          http: { url: "http://localhost:9999/events" },
          file: { path: "/tmp/fallback.jsonl" },
        },
        tools: [],
      });

      expect(config.audit.mode).toBe("http-with-fallback");
      expect(config.audit.http?.url).toBe("http://localhost:9999/events");
      expect(config.audit.file?.path).toBe("/tmp/fallback.jsonl");
    });
  });

  describe("legacy config conversion", () => {
    it("converts mode: http to new format", async () => {
      const config = await loadConfigWithMock({
        mode: "http",
        http: {
          url: "http://localhost:9999/events",
          sync: false,
          timeoutMs: 30000,
          timeoutAction: "block",
        },
        file: { path: "/tmp/toolwatch.jsonl" },
        tools: ["bash"],
      });

      expect(config.rules.mode).toBe("none"); // sync: false means no rules
      expect(config.audit.mode).toBe("http");
      expect(config.audit.http?.url).toBe("http://localhost:9999/events");
    });

    it("converts mode: file to new format", async () => {
      const config = await loadConfigWithMock({
        mode: "file",
        http: { url: "http://localhost:9999/events", sync: false },
        file: { path: "/tmp/toolwatch.jsonl" },
        tools: ["bash", "read"],
      });

      expect(config.rules.mode).toBe("none");
      expect(config.audit.mode).toBe("file");
      expect(config.audit.file?.path).toBe("/tmp/toolwatch.jsonl");
    });

    it("converts mode: both to new format", async () => {
      const config = await loadConfigWithMock({
        mode: "both",
        http: { url: "http://localhost:9999/events", sync: false },
        file: { path: "/tmp/toolwatch.jsonl" },
        tools: [],
      });

      expect(config.audit.mode).toBe("both");
      expect(config.audit.http?.url).toBe("http://localhost:9999/events");
      expect(config.audit.file?.path).toBe("/tmp/toolwatch.jsonl");
    });

    it("converts mode: http-with-fallback to new format", async () => {
      const config = await loadConfigWithMock({
        mode: "http-with-fallback",
        http: { url: "http://localhost:9999/events", sync: false },
        file: { path: "/tmp/fallback.jsonl" },
        tools: [],
      });

      expect(config.audit.mode).toBe("http-with-fallback");
      expect(config.audit.http?.url).toBe("http://localhost:9999/events");
      expect(config.audit.file?.path).toBe("/tmp/fallback.jsonl");
    });

    it("converts sync: true to remote rules mode", async () => {
      const config = await loadConfigWithMock({
        mode: "http",
        http: {
          url: "http://localhost:9999/events",
          sync: true,
          timeoutMs: 30000,
          timeoutAction: "block",
        },
        file: { path: "/tmp/toolwatch.jsonl" },
        tools: ["bash"],
      });

      expect(config.rules.mode).toBe("remote");
      expect(config.rules.timeoutMs).toBe(30000);
      expect(config.rules.errorAction).toBe("block");
    });

    it("converts timeoutAction to errorAction", async () => {
      const config = await loadConfigWithMock({
        mode: "http",
        http: {
          url: "http://localhost:9999/events",
          sync: true,
          timeoutMs: 5000,
          timeoutAction: "allow",
        },
        file: { path: "/tmp/toolwatch.jsonl" },
        tools: [],
      });

      expect(config.rules.errorAction).toBe("allow");
    });

    it("skips timeout config when timeoutMs is 0", async () => {
      const config = await loadConfigWithMock({
        mode: "http",
        http: {
          url: "http://localhost:9999/events",
          sync: true,
          timeoutMs: 0,
          timeoutAction: "block",
        },
        file: { path: "/tmp/toolwatch.jsonl" },
        tools: [],
      });

      expect(config.rules.mode).toBe("remote");
      expect(config.rules.timeoutMs).toBeUndefined();
      expect(config.rules.errorAction).toBeUndefined();
    });
  });

  describe("defaults", () => {
    it("returns default config when file not found", async () => {
      const config = await loadConfigWithMock(null);

      expect(config.rules.mode).toBe("none");
      expect(config.audit.mode).toBe("none");
      expect(config.tools).toEqual([]);
    });

    it("uses default values for missing fields in new format", async () => {
      const config = await loadConfigWithMock({
        rules: { mode: "local" },
        // audit and tools missing
      });

      expect(config.rules.mode).toBe("local");
      expect(config.audit.mode).toBe("none");
      expect(config.tools).toEqual([]);
    });
  });
});
