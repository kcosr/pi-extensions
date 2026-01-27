import type { ApplyPatchResult } from "./patch.js";

export function buildToolOutput(result: ApplyPatchResult): string {
  const summary = result.summary;
  const diffs = result.details.files.map((file) => file.unifiedDiff).filter((diff) => diff !== "");
  if (diffs.length === 0) {
    return summary;
  }

  return `${summary}\n${diffs.join("\n\n")}\n`;
}
