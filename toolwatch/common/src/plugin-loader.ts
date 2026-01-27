/**
 * Generic plugin loader.
 * Loads approval plugins from file paths or builtin references.
 */

import type { ApprovalPlugin } from "./types.js";

/** Cache of loaded plugins */
const pluginCache = new Map<string, ApprovalPlugin>();

/**
 * Pre-register a plugin instance.
 * Used to share instances between static and dynamic imports,
 * or to register builtin plugins.
 */
export function registerPlugin(name: string, plugin: ApprovalPlugin): void {
  pluginCache.set(name, plugin);
}

/**
 * Get a registered plugin by name.
 */
export function getPlugin(name: string): ApprovalPlugin | undefined {
  return pluginCache.get(name);
}

/**
 * Check if a plugin is registered.
 */
export function hasPlugin(name: string): boolean {
  return pluginCache.has(name);
}

/**
 * Load a plugin by name.
 * 
 * @param name - Plugin name (used for cache lookup)
 * @param pluginPath - Path to plugin module, or undefined to use cache only
 * @param basePath - Base path for resolving relative plugin paths
 * @returns The loaded plugin, or undefined if not found
 */
export async function loadPlugin(
  name: string,
  pluginPath: string | undefined,
  basePath?: string
): Promise<ApprovalPlugin | undefined> {
  // Check cache first (includes pre-registered plugins)
  if (pluginCache.has(name)) {
    return pluginCache.get(name);
  }

  // No path provided, can't load
  if (!pluginPath) {
    return undefined;
  }

  // Builtin plugins must be pre-registered
  if (pluginPath.startsWith("builtin:")) {
    console.error(`Builtin plugin not registered: ${pluginPath}`);
    return undefined;
  }

  // Resolve path
  let fullPath = pluginPath;
  if (basePath && !pluginPath.startsWith("/")) {
    // Dynamic import for path resolution (works in both Node and other runtimes)
    const { resolve } = await import("node:path");
    fullPath = resolve(basePath, pluginPath);
  }

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
 * Clear the plugin cache.
 * Useful for reloading plugins or testing.
 */
export function clearPluginCache(): void {
  pluginCache.clear();
}

/**
 * Get all registered plugin names.
 */
export function getRegisteredPlugins(): string[] {
  return Array.from(pluginCache.keys());
}
