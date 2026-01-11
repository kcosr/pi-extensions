import type { ToolCallEvent, Rule, MatchCondition, MatchValue, ApprovalResponse } from "./types.js";

/**
 * Get a nested value from an object using dot notation
 * e.g., getNestedValue(obj, "params.command")
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;

  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }

  return current;
}

/**
 * Check if a value matches a pattern
 * Pattern can be:
 * - Regular string: exact match
 * - /regex/: regex match
 */
function matchesPattern(value: unknown, pattern: string): boolean {
  if (value === null || value === undefined) return false;

  const stringValue = String(value);

  // Check if pattern is a regex (starts and ends with /)
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    const regexBody = pattern.slice(1, -1);
    try {
      const regex = new RegExp(regexBody);
      return regex.test(stringValue);
    } catch {
      // Invalid regex, fall back to exact match
      return stringValue === pattern;
    }
  }

  // Exact match
  return stringValue === pattern;
}

/**
 * Check if a value matches a match value (string or array of strings)
 * Array = OR (any pattern matches)
 */
function matchesValue(value: unknown, matchValue: MatchValue): boolean {
  if (Array.isArray(matchValue)) {
    // OR: any pattern matches
    return matchValue.some((pattern) => matchesPattern(value, pattern));
  }
  return matchesPattern(value, matchValue);
}

/**
 * Check if an event matches a condition
 * All fields in condition must match (AND)
 */
function matchesCondition(event: ToolCallEvent, condition: MatchCondition): boolean {
  for (const [field, matchValue] of Object.entries(condition)) {
    const value = getNestedValue(event as unknown as Record<string, unknown>, field);
    if (!matchesValue(value, matchValue)) {
      return false;
    }
  }
  return true;
}

/**
 * Find the first matching rule for an event
 */
export function findMatchingRule(event: ToolCallEvent, rules: Rule[]): Rule | undefined {
  for (const rule of rules) {
    // No match condition = matches everything
    if (!rule.match || Object.keys(rule.match).length === 0) {
      return rule;
    }

    if (matchesCondition(event, rule.match)) {
      return rule;
    }
  }

  return undefined;
}

/**
 * Evaluate rules and return immediate response for allow/deny
 * Returns undefined if a plugin should be invoked
 */
export function evaluateRules(
  event: ToolCallEvent,
  rules: Rule[]
): { response: ApprovalResponse; pluginName?: string } {
  const rule = findMatchingRule(event, rules);

  if (!rule) {
    // No matching rule, default allow
    return { response: { approved: true } };
  }

  switch (rule.action) {
    case "allow":
      return { response: { approved: true, reason: rule.comment } };

    case "deny":
      return { response: { approved: false, reason: rule.reason ?? rule.comment ?? "Denied by policy" } };

    case "plugin":
      if (!rule.plugin) {
        // Plugin action but no plugin specified, default deny
        return { response: { approved: false, reason: "Plugin not specified" } };
      }
      return { response: { approved: false }, pluginName: rule.plugin };
  }
}
