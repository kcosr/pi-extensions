/**
 * Utility functions for the extension.
 */

import os from "node:os";

/**
 * Get the current user name.
 */
export function getUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    const uid = process.getuid?.();
    return uid !== undefined ? `uid:${uid}` : "unknown";
  }
}

/**
 * Filter tool parameters to extract relevant subset per tool.
 * Avoids logging large content like file bodies.
 */
export function filterParams(tool: string, input: Record<string, unknown>): Record<string, unknown> {
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
