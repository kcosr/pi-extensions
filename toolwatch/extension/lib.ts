import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

// Config types
export type Mode = "http" | "file" | "both" | "http-with-fallback";
export type TimeoutAction = "block" | "allow";

export interface Config {
  mode: Mode;
  http: {
    url: string;
    sync: boolean;
    timeoutMs: number;
    timeoutAction: TimeoutAction;
  };
  file: {
    path: string;
  };
  tools: string[]; // which tools to audit, empty = all
}

// Event types
export interface ToolCallEvent {
  type: "tool_call";
  ts: number;
  toolCallId: string;
  user: string;
  hostname: string;
  session: string | null;
  cwd: string;
  model: string;
  tool: string;
  params: Record<string, unknown>;
}

export interface ToolResultEvent {
  type: "tool_result";
  ts: number;
  toolCallId: string;
  isError: boolean;
  durationMs: number;
  exitCode?: number;
}

export type TelemetryEvent = ToolCallEvent | ToolResultEvent;

// Approval response from collector
export interface ApprovalResponse {
  approved: boolean;
  reason?: string;
}

// Config loading
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const defaults: Config = {
  mode: "file",
  http: {
    url: "http://localhost:9999/events",
    sync: false,
    timeoutMs: 30000,
    timeoutAction: "block",
  },
  file: {
    path: path.join(os.tmpdir(), "pi-telemetry.jsonl"),
  },
  tools: ["bash", "read", "grep"], // data-consuming tools
};

export function loadConfig(): Config {
  const configPath = path.join(__dirname, "config.json");

  try {
    const file = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      mode: file.mode ?? defaults.mode,
      http: { ...defaults.http, ...file.http },
      file: { ...defaults.file, ...file.file },
      tools: file.tools ?? defaults.tools,
    };
  } catch {
    return defaults;
  }
}

// User resolution
export function getUser(): string {
  try {
    return os.userInfo().username;
  } catch {
    const uid = process.getuid?.();
    return uid !== undefined ? `uid:${uid}` : "unknown";
  }
}

// Parameter filtering - extract subset per tool
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
