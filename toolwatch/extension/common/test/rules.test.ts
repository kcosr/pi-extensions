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
    model: "test-model",
    tool: "bash",
    params: { command: "ls -la" },
    ...overrides,
  };
}

describe("findMatchingRule", () => {
  it("returns undefined for empty rules", () => {
    const event = makeEvent();
    expect(findMatchingRule(event, [])).toBeUndefined();
  });

  it("matches rule with no condition (catch-all)", () => {
    const event = makeEvent();
    const rules: Rule[] = [{ action: "allow" }];
    expect(findMatchingRule(event, rules)).toEqual({ action: "allow" });
  });

  it("matches rule with empty match object (catch-all)", () => {
    const event = makeEvent();
    const rules: Rule[] = [{ match: {}, action: "allow" }];
    expect(findMatchingRule(event, rules)).toEqual({ match: {}, action: "allow" });
  });

  it("matches exact tool name", () => {
    const event = makeEvent({ tool: "bash" });
    const rules: Rule[] = [
      { match: { tool: "read" }, action: "deny" },
      { match: { tool: "bash" }, action: "allow" },
    ];
    expect(findMatchingRule(event, rules)?.action).toBe("allow");
  });

  it("matches nested params with dot notation", () => {
    const event = makeEvent({ params: { command: "rm -rf /tmp" } });
    const rules: Rule[] = [{ match: { "params.command": "rm -rf /tmp" }, action: "deny" }];
    expect(findMatchingRule(event, rules)?.action).toBe("deny");
  });

  it("matches regex pattern", () => {
    const event = makeEvent({ params: { command: "rm -rf /important" } });
    const rules: Rule[] = [{ match: { "params.command": "/rm\\s+-rf/" }, action: "deny" }];
    expect(findMatchingRule(event, rules)?.action).toBe("deny");
  });

  it("does not match regex when pattern doesn't match", () => {
    const event = makeEvent({ params: { command: "ls -la" } });
    const rules: Rule[] = [
      { match: { "params.command": "/rm\\s+-rf/" }, action: "deny" },
      { action: "allow" },
    ];
    expect(findMatchingRule(event, rules)?.action).toBe("allow");
  });

  it("matches array of values (OR)", () => {
    const event = makeEvent({ tool: "read" });
    const rules: Rule[] = [{ match: { tool: ["bash", "read", "write"] }, action: "deny" }];
    expect(findMatchingRule(event, rules)?.action).toBe("deny");
  });

  it("matches array with regex patterns", () => {
    const event = makeEvent({ params: { command: "sudo apt install" } });
    const rules: Rule[] = [
      { match: { "params.command": ["/rm\\s+-rf/", "/sudo/", "/shutdown/"] }, action: "deny" },
    ];
    expect(findMatchingRule(event, rules)?.action).toBe("deny");
  });

  it("requires all conditions to match (AND)", () => {
    const event = makeEvent({ tool: "bash", user: "admin" });
    const rules: Rule[] = [
      { match: { tool: "bash", user: "root" }, action: "deny" },
      { match: { tool: "bash", user: "admin" }, action: "allow" },
    ];
    expect(findMatchingRule(event, rules)?.action).toBe("allow");
  });

  it("returns first matching rule", () => {
    const event = makeEvent({ tool: "bash" });
    const rules: Rule[] = [
      { match: { tool: "bash" }, action: "deny", comment: "first" },
      { match: { tool: "bash" }, action: "allow", comment: "second" },
    ];
    expect(findMatchingRule(event, rules)?.comment).toBe("first");
  });

  it("handles missing nested values", () => {
    const event = makeEvent({ params: {} });
    const rules: Rule[] = [
      { match: { "params.command": "test" }, action: "deny" },
      { action: "allow" },
    ];
    expect(findMatchingRule(event, rules)?.action).toBe("allow");
  });

  it("handles invalid regex gracefully (falls back to exact match)", () => {
    const event = makeEvent({ params: { command: "/[invalid/" } });
    const rules: Rule[] = [
      { match: { "params.command": "/[invalid/" }, action: "deny" },
      { action: "allow" },
    ];
    // Invalid regex falls back to exact match, which should match
    expect(findMatchingRule(event, rules)?.action).toBe("deny");
  });
});

describe("evaluateRules", () => {
  it("returns approved=true for empty rules (default allow)", () => {
    const event = makeEvent();
    const result = evaluateRules(event, []);
    expect(result.response.approved).toBe(true);
    expect(result.pluginName).toBeUndefined();
  });

  it("returns approved=true for allow action", () => {
    const event = makeEvent();
    const rules: Rule[] = [{ action: "allow", comment: "All allowed" }];
    const result = evaluateRules(event, rules);
    expect(result.response.approved).toBe(true);
    expect(result.response.reason).toBe("All allowed");
  });

  it("returns approved=false for deny action", () => {
    const event = makeEvent({ tool: "bash" });
    const rules: Rule[] = [{ match: { tool: "bash" }, action: "deny", reason: "No bash" }];
    const result = evaluateRules(event, rules);
    expect(result.response.approved).toBe(false);
    expect(result.response.reason).toBe("No bash");
  });

  it("uses comment as reason if no explicit reason", () => {
    const event = makeEvent({ tool: "bash" });
    const rules: Rule[] = [{ match: { tool: "bash" }, action: "deny", comment: "Bash disabled" }];
    const result = evaluateRules(event, rules);
    expect(result.response.reason).toBe("Bash disabled");
  });

  it("uses default reason if no reason or comment", () => {
    const event = makeEvent({ tool: "bash" });
    const rules: Rule[] = [{ match: { tool: "bash" }, action: "deny" }];
    const result = evaluateRules(event, rules);
    expect(result.response.reason).toBe("Denied by policy");
  });

  it("returns plugin name for plugin action", () => {
    const event = makeEvent({ params: { path: ".env" } });
    const rules: Rule[] = [{ match: { "params.path": "/.env/" }, action: "plugin", plugin: "manual" }];
    const result = evaluateRules(event, rules);
    expect(result.pluginName).toBe("manual");
    expect(result.matchedRule?.plugin).toBe("manual");
  });

  it("denies if plugin action has no plugin specified", () => {
    const event = makeEvent();
    const rules: Rule[] = [{ action: "plugin" }]; // Missing plugin field
    const result = evaluateRules(event, rules);
    expect(result.response.approved).toBe(false);
    expect(result.response.reason).toBe("Plugin not specified");
  });

  it("includes matched rule in result", () => {
    const event = makeEvent({ tool: "bash" });
    const rule: Rule = { match: { tool: "bash" }, action: "allow", comment: "Allow bash" };
    const result = evaluateRules(event, [rule]);
    expect(result.matchedRule).toEqual(rule);
  });

  it("does not include matched rule when no match (default allow)", () => {
    const event = makeEvent({ tool: "bash" });
    const rules: Rule[] = [{ match: { tool: "read" }, action: "deny" }];
    const result = evaluateRules(event, rules);
    expect(result.response.approved).toBe(true);
    expect(result.matchedRule).toBeUndefined();
  });
});
