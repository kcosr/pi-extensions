/**
 * Plugin loader for collector.
 * Wraps common plugin-loader with collector-specific path resolution.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerPlugin as commonRegisterPlugin,
  loadPlugin as commonLoadPlugin,
  clearPluginCache,
  type ApprovalPlugin,
  type CollectorConfig,
} from "@pi-extensions/toolwatch-common";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);

// Re-export common functions
export { clearPluginCache };
export const registerPlugin = commonRegisterPlugin;

/**
 * Load a plugin by name from config.
 * Resolves paths relative to collector root.
 */
export async function loadPlugin(
  name: string,
  config: CollectorConfig
): Promise<ApprovalPlugin | undefined> {
  const pluginPath = config.plugins[name];
  return commonLoadPlugin(name, pluginPath, rootDir);
}
