/**
 * Tests for rules engine
 */

import { describe, it, expect } from "vitest";
import { findMatchingRule, evaluateRules } from "../src/rules.js";
import type { ToolCallEvent, Rule } from "../src/types.js";

function makeEvent(overrides: Partial<ToolCallEvent> = {}): ToolCallEvent {
  return {
    type: "tool_call",
    ts: Date.now(),
    toolCallId: "test-123",
    user: "testuser",
    hostname: "testhost",
    session: null,
    cwd: "/home/test",
    model: "claude-sonnet",
    tool: "bash",
    params: { command: "ls -la" },
    ...overrides,
  };
}

describe("findMatchingRule", () => {
  it("returns undefined for empty rules", () => {
    const result = findMatchingRule(makeEvent(), []);
    expect(result).toBeUndefined();
  });

  it("matches rule with no conditions (catch-all)", () => {
    const rules: Rule[] = [{ action: "allow" }];
    const result = findMatchingRule(makeEvent(), rules);
    expect(result).toEqual({ action: "allow" });
  });

  it("matches rule with empty match object (catch-all)", () => {
    const rules: Rule[] = [{ match: {}, action: "allow" }];
    const result = findMatchingRule(makeEvent(), rules);
    expect(result).toEqual({ match: {}, action: "allow" });
  });

  describe("exact matching", () => {
    it("matches exact tool name", () => {
      const rules: Rule[] = [
        { match: { tool: "bash" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(makeEvent({ tool: "bash" }), rules);
      expect(result?.action).toBe("deny");
    });

    it("does not match different tool name", () => {
      const rules: Rule[] = [
        { match: { tool: "read" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(makeEvent({ tool: "bash" }), rules);
      expect(result?.action).toBe("allow");
    });

    it("matches exact user", () => {
      const rules: Rule[] = [
        { match: { user: "admin" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(makeEvent({ user: "admin" }), rules);
      expect(result?.action).toBe("deny");
    });
  });

  describe("regex matching", () => {
    it("matches regex pattern in params.command", () => {
      const rules: Rule[] = [
        { match: { "params.command": "/rm\\s+-rf/" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(
        makeEvent({ params: { command: "rm -rf /tmp" } }),
        rules
      );
      expect(result?.action).toBe("deny");
    });

    it("does not match non-matching regex", () => {
      const rules: Rule[] = [
        { match: { "params.command": "/rm\\s+-rf/" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(
        makeEvent({ params: { command: "ls -la" } }),
        rules
      );
      expect(result?.action).toBe("allow");
    });

    it("matches regex pattern in params.path", () => {
      const rules: Rule[] = [
        { match: { "params.path": "/\\.env$/" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(
        makeEvent({ tool: "read", params: { path: "/home/user/.env" } }),
        rules
      );
      expect(result?.action).toBe("deny");
    });

    it("handles invalid regex gracefully (falls back to exact match)", () => {
      const rules: Rule[] = [
        { match: { "params.command": "/[invalid/" }, action: "deny" },
        { action: "allow" },
      ];
      // Should not crash, should fall back to exact match
      const result = findMatchingRule(
        makeEvent({ params: { command: "test" } }),
        rules
      );
      expect(result?.action).toBe("allow");
    });
  });

  describe("array (OR) matching", () => {
    it("matches any pattern in array", () => {
      const rules: Rule[] = [
        { match: { tool: ["bash", "read", "grep"] }, action: "deny" },
        { action: "allow" },
      ];

      expect(findMatchingRule(makeEvent({ tool: "bash" }), rules)?.action).toBe("deny");
      expect(findMatchingRule(makeEvent({ tool: "read" }), rules)?.action).toBe("deny");
      expect(findMatchingRule(makeEvent({ tool: "grep" }), rules)?.action).toBe("deny");
      expect(findMatchingRule(makeEvent({ tool: "write" }), rules)?.action).toBe("allow");
    });

    it("matches any regex pattern in array", () => {
      const rules: Rule[] = [
        { 
          match: { "params.command": ["/rm\\s+-rf/", "/sudo/", "/shutdown/"] }, 
          action: "deny" 
        },
        { action: "allow" },
      ];

      expect(
        findMatchingRule(makeEvent({ params: { command: "rm -rf /" } }), rules)?.action
      ).toBe("deny");
      expect(
        findMatchingRule(makeEvent({ params: { command: "sudo apt install" } }), rules)?.action
      ).toBe("deny");
      expect(
        findMatchingRule(makeEvent({ params: { command: "ls -la" } }), rules)?.action
      ).toBe("allow");
    });
  });

  describe("nested field matching", () => {
    it("matches nested params fields", () => {
      const rules: Rule[] = [
        { match: { "params.path": "/etc/passwd" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(
        makeEvent({ tool: "read", params: { path: "/etc/passwd" } }),
        rules
      );
      expect(result?.action).toBe("deny");
    });

    it("handles missing nested fields", () => {
      const rules: Rule[] = [
        { match: { "params.nonexistent": "value" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(makeEvent(), rules);
      expect(result?.action).toBe("allow");
    });

    it("handles deeply nested fields", () => {
      const rules: Rule[] = [
        { match: { "params.nested.deep": "value" }, action: "deny" },
        { action: "allow" },
      ];
      const result = findMatchingRule(
        makeEvent({ params: { nested: { deep: "value" } } }),
        rules
      );
      expect(result?.action).toBe("deny");
    });
  });

  describe("multiple field (AND) matching", () => {
    it("requires all fields to match", () => {
      const rules: Rule[] = [
        { match: { tool: "bash", user: "admin" }, action: "deny" },
        { action: "allow" },
      ];

      // Both match
      expect(
        findMatchingRule(makeEvent({ tool: "bash", user: "admin" }), rules)?.action
      ).toBe("deny");

      // Only tool matches
      expect(
        findMatchingRule(makeEvent({ tool: "bash", user: "guest" }), rules)?.action
      ).toBe("allow");

      // Only user matches
      expect(
        findMatchingRule(makeEvent({ tool: "read", user: "admin" }), rules)?.action
      ).toBe("allow");
    });

    it("combines exact and regex matching", () => {
      const rules: Rule[] = [
        { 
          match: { 
            tool: "bash", 
            "params.command": "/rm/" 
          }, 
          action: "deny" 
        },
        { action: "allow" },
      ];

      expect(
        findMatchingRule(
          makeEvent({ tool: "bash", params: { command: "rm file.txt" } }), 
          rules
        )?.action
      ).toBe("deny");

      expect(
        findMatchingRule(
          makeEvent({ tool: "bash", params: { command: "ls -la" } }), 
          rules
        )?.action
      ).toBe("allow");

      expect(
        findMatchingRule(
          makeEvent({ tool: "read", params: { command: "rm file.txt" } }), 
          rules
        )?.action
      ).toBe("allow");
    });
  });

  describe("rule priority (first match wins)", () => {
    it("returns first matching rule", () => {
      const rules: Rule[] = [
        { match: { tool: "bash" }, action: "deny", comment: "first" },
        { match: { tool: "bash" }, action: "allow", comment: "second" },
        { action: "allow" },
      ];
      const result = findMatchingRule(makeEvent({ tool: "bash" }), rules);
      expect(result?.comment).toBe("first");
      expect(result?.action).toBe("deny");
    });

    it("skips non-matching rules", () => {
      const rules: Rule[] = [
        { match: { tool: "read" }, action: "deny", comment: "first" },
        { match: { tool: "bash" }, action: "plugin", comment: "second" },
        { action: "allow", comment: "catch-all" },
      ];
      const result = findMatchingRule(makeEvent({ tool: "bash" }), rules);
      expect(result?.comment).toBe("second");
    });
  });
});

describe("evaluateRules", () => {
  it("returns approved:true for allow action", () => {
    const rules: Rule[] = [{ action: "allow" }];
    const { response, pluginName } = evaluateRules(makeEvent(), rules);
    expect(response.approved).toBe(true);
    expect(pluginName).toBeUndefined();
  });

  it("returns approved:false with reason for deny action", () => {
    const rules: Rule[] = [
      { match: { tool: "bash" }, action: "deny", reason: "Bash not allowed" },
    ];
    const { response, pluginName } = evaluateRules(makeEvent({ tool: "bash" }), rules);
    expect(response.approved).toBe(false);
    expect(response.reason).toBe("Bash not allowed");
    expect(pluginName).toBeUndefined();
  });

  it("returns default reason for deny without reason", () => {
    const rules: Rule[] = [{ match: { tool: "bash" }, action: "deny" }];
    const { response } = evaluateRules(makeEvent({ tool: "bash" }), rules);
    expect(response.approved).toBe(false);
    expect(response.reason).toBe("Denied by policy");
  });

  it("returns pluginName for plugin action", () => {
    const rules: Rule[] = [
      { match: { tool: "bash" }, action: "plugin", plugin: "manual" },
    ];
    const { response, pluginName } = evaluateRules(makeEvent({ tool: "bash" }), rules);
    expect(pluginName).toBe("manual");
  });

  it("returns deny for plugin action without plugin specified", () => {
    const rules: Rule[] = [{ match: { tool: "bash" }, action: "plugin" }];
    const { response, pluginName } = evaluateRules(makeEvent({ tool: "bash" }), rules);
    expect(response.approved).toBe(false);
    expect(response.reason).toBe("Plugin not specified");
    expect(pluginName).toBeUndefined();
  });

  it("returns approved:true when no rules match (default allow)", () => {
    const rules: Rule[] = [{ match: { tool: "read" }, action: "deny" }];
    const { response } = evaluateRules(makeEvent({ tool: "bash" }), rules);
    expect(response.approved).toBe(true);
  });

  it("includes comment as reason for allow", () => {
    const rules: Rule[] = [{ action: "allow", comment: "Allowed by policy" }];
    const { response } = evaluateRules(makeEvent(), rules);
    expect(response.approved).toBe(true);
    expect(response.reason).toBe("Allowed by policy");
  });

  it("prefers reason over comment for deny", () => {
    const rules: Rule[] = [
      { 
        match: { tool: "bash" }, 
        action: "deny", 
        comment: "Dangerous command", 
        reason: "Custom reason" 
      },
    ];
    const { response } = evaluateRules(makeEvent({ tool: "bash" }), rules);
    expect(response.reason).toBe("Custom reason");
  });
});
