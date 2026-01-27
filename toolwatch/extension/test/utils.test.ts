/**
 * Tests for utility functions.
 */

import { describe, it, expect } from "vitest";
import { filterParams } from "../src/utils.js";

describe("filterParams", () => {
  describe("bash", () => {
    it("extracts command and timeout", () => {
      const result = filterParams("bash", {
        command: "ls -la",
        timeout: 30,
        extra: "ignored",
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
        limit: 100,
        content: "should be ignored",
      });

      expect(result).toEqual({ path: "/etc/passwd", offset: 10, limit: 100 });
    });
  });

  describe("write", () => {
    it("extracts only path, skips content", () => {
      const result = filterParams("write", {
        path: "/tmp/file.txt",
        content: "This is secret content that should not be logged",
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
        newText: "new content",
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
        include: "*.ts",
        extra: "ignored",
      });

      expect(result).toEqual({ pattern: "TODO", path: "/src", include: "*.ts" });
    });
  });

  describe("find", () => {
    it("extracts path, pattern, type", () => {
      const result = filterParams("find", {
        path: "/home",
        pattern: "*.log",
        type: "f",
      });

      expect(result).toEqual({ path: "/home", pattern: "*.log", type: "f" });
    });
  });

  describe("ls", () => {
    it("extracts only path", () => {
      const result = filterParams("ls", { path: "/var/log", extra: "ignored" });

      expect(result).toEqual({ path: "/var/log" });
    });
  });

  describe("custom tools", () => {
    it("includes all params for unknown tools", () => {
      const result = filterParams("custom_tool", {
        foo: "bar",
        num: 42,
        bool: true,
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
        arr: [1, 2, 3, 4, 5],
      });

      expect(result.num).toBe(12345678901234567890);
      expect(result.arr).toEqual([1, 2, 3, 4, 5]);
    });

    it("handles exactly 200 character strings", () => {
      const exactString = "x".repeat(200);
      const result = filterParams("custom_tool", { data: exactString });

      expect(result.data).toBe(exactString);
    });

    it("truncates strings at 201 characters", () => {
      const longString = "x".repeat(201);
      const result = filterParams("custom_tool", { data: longString });

      expect(result.data).toBe("x".repeat(200) + "...[truncated]");
    });
  });
});
