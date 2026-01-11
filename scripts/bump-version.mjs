#!/usr/bin/env node
/**
 * bump-version.mjs
 *
 * Updates the VERSION file with a new semantic version.
 *
 * Usage:
 *   node scripts/bump-version.mjs patch     # 1.0.0 -> 1.0.1
 *   node scripts/bump-version.mjs minor     # 1.0.1 -> 1.1.0
 *   node scripts/bump-version.mjs major     # 1.1.0 -> 2.0.0
 *   node scripts/bump-version.mjs 2.0.0     # Set to specific version
 *   node scripts/bump-version.mjs           # Show current version
 */

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const versionFilePath = join(root, "VERSION");

function readVersion() {
  try {
    return readFileSync(versionFilePath, "utf8").trim();
  } catch {
    return "0.0.0";
  }
}

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(.*)$/);
  if (!match) {
    return null;
  }
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
    suffix: match[4] || "",
  };
}

function formatVersion(parts) {
  return `${parts.major}.${parts.minor}.${parts.patch}${parts.suffix}`;
}

function findPackageJsonFiles(dir, results = []) {
  const ignoredDirs = new Set([".git", "node_modules", "dist"]);
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) {
        findPackageJsonFiles(entryPath, results);
      }
    } else if (entry.name === "package.json") {
      results.push(entryPath);
    }
  }

  return results;
}

function updatePackageJsonVersions(version) {
  const packageJsonPaths = findPackageJsonFiles(root);
  let updatedCount = 0;

  for (const packageJsonPath of packageJsonPaths) {
    const raw = readFileSync(packageJsonPath, "utf8");
    const data = JSON.parse(raw);
    if (data.version === version) {
      continue;
    }
    data.version = version;
    writeFileSync(packageJsonPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    updatedCount += 1;
    console.log(`  Updated: ${packageJsonPath}`);
  }

  return updatedCount;
}

const currentVersion = readVersion();
const arg = process.argv[2];

if (!arg) {
  console.log(`Current version: ${currentVersion}`);
  process.exit(0);
}

const parts = parseVersion(currentVersion);
if (!parts) {
  console.error(`Current VERSION "${currentVersion}" is not valid semver (X.Y.Z)`);
  process.exit(1);
}

let newVersion;

switch (arg.toLowerCase()) {
  case "patch":
    parts.patch += 1;
    parts.suffix = "";
    newVersion = formatVersion(parts);
    break;
  case "minor":
    parts.minor += 1;
    parts.patch = 0;
    parts.suffix = "";
    newVersion = formatVersion(parts);
    break;
  case "major":
    parts.major += 1;
    parts.minor = 0;
    parts.patch = 0;
    parts.suffix = "";
    newVersion = formatVersion(parts);
    break;
  default:
    if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(arg)) {
      console.error(
        `Invalid version: "${arg}". Use patch, minor, major, or a semver like 1.2.3`
      );
      process.exit(1);
    }
    newVersion = arg;
}

writeFileSync(versionFilePath, `${newVersion}\n`, "utf8");
console.log(`Version updated: ${currentVersion} -> ${newVersion}`);

const updatedCount = updatePackageJsonVersions(newVersion);
if (updatedCount > 0) {
  console.log(`Updated ${updatedCount} package.json file(s).`);
}
