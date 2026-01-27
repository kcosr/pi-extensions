/**
 * Extension configuration loading.
 * Supports both legacy and new config formats.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import type { Config, RulesConfig, AuditConfig } from "@pi-extensions/toolwatch-common";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When bundled, __dirname is the extension dir. When running from src/, go up one level.
const extensionDir = __dirname.endsWith("/src") ? path.dirname(__dirname) : __dirname;

// ============================================================================
// Legacy Config Types (for migration)
// ============================================================================

type LegacyMode = "http" | "file" | "both" | "http-with-fallback";
type LegacyTimeoutAction = "block" | "allow";

interface LegacyConfig {
  mode: LegacyMode;
  http: {
    url: string;
    sync: boolean;
    timeoutMs: number;
    timeoutAction: LegacyTimeoutAction;
  };
  file: {
    path: string;
  };
  tools: string[];
}

// ============================================================================
// Defaults
// ============================================================================

const defaultConfig: Config = {
  rules: { mode: "none" },
  audit: { mode: "none" },
  tools: [],
};

const legacyDefaults: LegacyConfig = {
  mode: "file",
  http: {
    url: "http://localhost:9999/events",
    sync: false,
    timeoutMs: 30000,
    timeoutAction: "block",
  },
  file: {
    path: path.join(os.tmpdir(), "toolwatch.jsonl"),
  },
  tools: ["bash", "read", "grep"],
};

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Check if config is legacy format.
 */
function isLegacyConfig(config: unknown): config is Partial<LegacyConfig> {
  return typeof config === "object" && config !== null && "mode" in config && !("rules" in config);
}

/**
 * Convert legacy config to new format.
 */
function convertLegacyConfig(legacy: Partial<LegacyConfig>): Config {
  const mode = legacy.mode ?? legacyDefaults.mode;
  const http = { ...legacyDefaults.http, ...legacy.http };
  const file = { ...legacyDefaults.file, ...legacy.file };
  const tools = legacy.tools ?? legacyDefaults.tools;

  // Determine audit mode
  let auditMode: AuditConfig["mode"] = "none";
  if (mode === "http") auditMode = "http";
  else if (mode === "file") auditMode = "file";
  else if (mode === "both") auditMode = "both";
  else if (mode === "http-with-fallback") auditMode = "http-with-fallback";

  // Build audit config
  const audit: AuditConfig = { mode: auditMode };
  if (auditMode === "http" || auditMode === "both" || auditMode === "http-with-fallback") {
    audit.http = { url: http.url };
  }
  if (auditMode === "file" || auditMode === "both" || auditMode === "http-with-fallback") {
    audit.file = { path: file.path };
  }

  // Determine rules mode (sync=true means remote rules)
  const rulesMode: RulesConfig["mode"] = http.sync ? "remote" : "none";
  const rules: RulesConfig = { mode: rulesMode };
  
  if (rulesMode === "remote") {
    if (http.timeoutMs > 0) {
      rules.timeoutMs = http.timeoutMs;
      rules.errorAction = http.timeoutAction;
    }
  }

  return { rules, audit, tools };
}

/**
 * Parse new config format.
 */
function parseNewConfig(raw: Record<string, unknown>): Config {
  const rules = (raw.rules as RulesConfig) ?? defaultConfig.rules;
  const audit = (raw.audit as AuditConfig) ?? defaultConfig.audit;
  const tools = (raw.tools as string[]) ?? defaultConfig.tools;

  return { rules, audit, tools };
}

/**
 * Load configuration from config.json.
 */
export function loadConfig(): Config {
  const configPath = path.join(extensionDir, "config.json");

  try {
    const raw = JSON.parse(fs.readFileSync(configPath, "utf-8"));

    if (isLegacyConfig(raw)) {
      console.log("[toolwatch] Converting legacy config format");
      return convertLegacyConfig(raw);
    }

    return parseNewConfig(raw);
  } catch (err) {
    console.error("[toolwatch] Failed to load config, using defaults:", err);
    return defaultConfig;
  }
}

/**
 * Get the extension directory path.
 */
export function getExtensionDir(): string {
  return extensionDir;
}
