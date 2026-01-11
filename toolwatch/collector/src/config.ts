import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "./types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.dirname(__dirname);

const defaults: Config = {
  rules: [{ action: "allow" }],
  plugins: {},
};

export function loadConfig(): Config {
  const configPath = path.join(rootDir, "config.json");

  try {
    const file = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    return {
      rules: file.rules ?? defaults.rules,
      plugins: file.plugins ?? defaults.plugins,
    };
  } catch (err) {
    console.warn("Failed to load config.json, using defaults:", err);
    return defaults;
  }
}
