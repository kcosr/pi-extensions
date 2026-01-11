import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ApprovalPlugin, Config } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);

// Cache loaded plugins
const pluginCache = new Map<string, ApprovalPlugin>();

/**
 * Pre-register a plugin (used to share instances between static and dynamic imports)
 */
export function registerPlugin(name: string, plugin: ApprovalPlugin): void {
  pluginCache.set(name, plugin);
}

/**
 * Load a plugin by name from config
 */
export async function loadPlugin(name: string, config: Config): Promise<ApprovalPlugin | undefined> {
  // Check cache first (includes pre-registered plugins)
  if (pluginCache.has(name)) {
    return pluginCache.get(name);
  }

  const pluginPath = config.plugins[name];
  if (!pluginPath) {
    console.error(`Plugin not found in config: ${name}`);
    return undefined;
  }

  // Resolve path relative to collector root
  const fullPath = path.resolve(rootDir, pluginPath);

  try {
    const module = await import(fullPath);
    const plugin = module.default as ApprovalPlugin;

    if (!plugin || typeof plugin.evaluate !== "function") {
      console.error(`Invalid plugin (missing evaluate function): ${name}`);
      return undefined;
    }

    pluginCache.set(name, plugin);
    return plugin;
  } catch (err) {
    console.error(`Failed to load plugin ${name} from ${fullPath}:`, err);
    return undefined;
  }
}

/**
 * Clear the plugin cache (useful for reloading)
 */
export function clearPluginCache(): void {
  pluginCache.clear();
}
