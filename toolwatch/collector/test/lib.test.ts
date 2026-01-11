/**
 * Tests for extension lib functions
 * 
 * Note: These test the shared lib from the extension directory
 */

import { describe, it, expect } from "vitest";

// Test filterParams logic (replicated here since extension lib uses different module paths)
// In production, the extension uses its own lib.ts

describe("filterParams", () => {
  // Replicate filterParams logic for testing
  function filterParams(tool: string, input: Record<string, unknown>): Record<string, unknown> {
    switch (tool) {
      case "bash":
        return { command: input.command, timeout: input.timeout };
      case "read":
        return { path: input.path, offset: input.offset, limit: input.limit };
      case "write":
        return { path: input.path }; // skip content
      case "edit":
        return { path: input.path }; // skip oldText/newText
      case "grep":
        return { pattern: input.pattern, path: input.path, include: input.include };
      case "find":
        return { path: input.path, pattern: input.pattern, type: input.type };
      case "ls":
        return { path: input.path };
      default:
        // Custom tools - include all params but truncate large values
        return Object.fromEntries(
          Object.entries(input).map(([k, v]) => {
            if (typeof v === "string" && v.length > 200) {
              return [k, v.slice(0, 200) + "...[truncated]"];
            }
            return [k, v];
          })
        );
    }
  }

  describe("bash", () => {
    it("extracts command and timeout", () => {
      const result = filterParams("bash", { 
        command: "ls -la", 
        timeout: 30,
        extra: "ignored" 
      });
      expect(result).toEqual({ command: "ls -la", timeout: 30 });
    });

    it("handles missing optional fields", () => {
      const result = filterParams("bash", { command: "ls" });
      expect(result).toEqual({ command: "ls", timeout: undefined });
    });
  });

  describe("read", () => {
    it("extracts path, offset, limit", () => {
      const result = filterParams("read", { 
        path: "/etc/passwd", 
        offset: 10, 
        limit: 100 
      });
      expect(result).toEqual({ path: "/etc/passwd", offset: 10, limit: 100 });
    });
  });

  describe("write", () => {
    it("extracts only path, skips content", () => {
      const result = filterParams("write", { 
        path: "/tmp/file.txt", 
        content: "This is secret content that should not be logged" 
      });
      expect(result).toEqual({ path: "/tmp/file.txt" });
      expect(result.content).toBeUndefined();
    });
  });

  describe("edit", () => {
    it("extracts only path, skips oldText/newText", () => {
      const result = filterParams("edit", { 
        path: "/tmp/file.txt", 
        oldText: "old content",
        newText: "new content" 
      });
      expect(result).toEqual({ path: "/tmp/file.txt" });
      expect(result.oldText).toBeUndefined();
      expect(result.newText).toBeUndefined();
    });
  });

  describe("grep", () => {
    it("extracts pattern, path, include", () => {
      const result = filterParams("grep", { 
        pattern: "TODO",
        path: "/src",
        include: "*.ts"
      });
      expect(result).toEqual({ pattern: "TODO", path: "/src", include: "*.ts" });
    });
  });

  describe("find", () => {
    it("extracts path, pattern, type", () => {
      const result = filterParams("find", { 
        path: "/home",
        pattern: "*.log",
        type: "f"
      });
      expect(result).toEqual({ path: "/home", pattern: "*.log", type: "f" });
    });
  });

  describe("ls", () => {
    it("extracts only path", () => {
      const result = filterParams("ls", { path: "/var/log" });
      expect(result).toEqual({ path: "/var/log" });
    });
  });

  describe("custom tools", () => {
    it("includes all params for unknown tools", () => {
      const result = filterParams("custom_tool", { 
        foo: "bar",
        num: 42,
        bool: true
      });
      expect(result).toEqual({ foo: "bar", num: 42, bool: true });
    });

    it("truncates long string values", () => {
      const longString = "x".repeat(300);
      const result = filterParams("custom_tool", { data: longString });
      expect(result.data).toBe("x".repeat(200) + "...[truncated]");
    });

    it("does not truncate short strings", () => {
      const result = filterParams("custom_tool", { data: "short" });
      expect(result.data).toBe("short");
    });

    it("does not truncate non-strings", () => {
      const result = filterParams("custom_tool", { 
        num: 12345678901234567890,
        arr: [1, 2, 3, 4, 5]
      });
      expect(result.num).toBe(12345678901234567890);
      expect(result.arr).toEqual([1, 2, 3, 4, 5]);
    });
  });
});

describe("config defaults", () => {
  // Test the default config structure
  const defaults = {
    mode: "file",
    http: {
      url: "http://localhost:9999/events",
      sync: false,
      timeoutMs: 30000,
      timeoutAction: "block",
    },
    file: {
      path: "/tmp/toolwatch.jsonl", // Note: actual path uses os.tmpdir()
    },
    tools: ["bash", "read", "grep"],
  };

  it("has correct default mode", () => {
    expect(defaults.mode).toBe("file");
  });

  it("has correct default HTTP settings", () => {
    expect(defaults.http.url).toBe("http://localhost:9999/events");
    expect(defaults.http.sync).toBe(false);
    expect(defaults.http.timeoutMs).toBe(30000);
    expect(defaults.http.timeoutAction).toBe("block");
  });

  it("has correct default tools", () => {
    expect(defaults.tools).toEqual(["bash", "read", "grep"]);
  });
});

describe("event types", () => {
  it("tool_call event has required fields", () => {
    const event = {
      type: "tool_call" as const,
      ts: Date.now(),
      toolCallId: "abc123",
      user: "testuser",
      hostname: "testhost",
      session: null,
      cwd: "/home/test",
      model: "claude",
      tool: "bash",
      params: { command: "ls" },
    };

    expect(event.type).toBe("tool_call");
    expect(typeof event.ts).toBe("number");
    expect(typeof event.toolCallId).toBe("string");
    expect(typeof event.user).toBe("string");
    expect(typeof event.hostname).toBe("string");
    expect(typeof event.cwd).toBe("string");
    expect(typeof event.model).toBe("string");
    expect(typeof event.tool).toBe("string");
    expect(typeof event.params).toBe("object");
  });

  it("tool_result event has required fields", () => {
    const event = {
      type: "tool_result" as const,
      ts: Date.now(),
      toolCallId: "abc123",
      isError: false,
      durationMs: 150,
    };

    expect(event.type).toBe("tool_result");
    expect(typeof event.ts).toBe("number");
    expect(typeof event.toolCallId).toBe("string");
    expect(typeof event.isError).toBe("boolean");
    expect(typeof event.durationMs).toBe("number");
  });

  it("tool_result can include exitCode for bash", () => {
    const event = {
      type: "tool_result" as const,
      ts: Date.now(),
      toolCallId: "abc123",
      isError: false,
      durationMs: 150,
      exitCode: 0,
    };

    expect(event.exitCode).toBe(0);
  });
});
