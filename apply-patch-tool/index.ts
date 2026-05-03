import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch } from "./patch.js";
import { buildToolOutput } from "./tool-output.js";

const PROMPT_MESSAGE_TYPE = "apply-patch-tool-instructions";
const PROMPT_FILENAME = "apply_patch_prompt.md";
const COLLAPSED_DIFF_LINES = 10;

function getExtensionDir(): string {
  return path.dirname(fileURLToPath(import.meta.url));
}

function loadPromptText(): string {
  const promptPath = path.join(getExtensionDir(), PROMPT_FILENAME);
  return fs.readFileSync(promptPath, "utf-8");
}

function isCustomMessageEntry(entry: unknown): entry is { type: "custom_message"; customType: string } {
  if (!entry || typeof entry !== "object") return false;
  const record = entry as Record<string, unknown>;
  return record.type === "custom_message" && typeof record.customType === "string";
}

function textContent(result: any): string {
  const content = result?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (part && part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .filter(Boolean)
    .join("\n");
}

function style(theme: any, color: string, text: string): string {
  if (theme && typeof theme.fg === "function") return theme.fg(color, text);
  switch (color) {
    case "toolDiffAdded":
    case "success":
      return `\x1b[32m${text}\x1b[39m`;
    case "toolDiffRemoved":
    case "error":
      return `\x1b[31m${text}\x1b[39m`;
    case "accent":
      return `\x1b[36m${text}\x1b[39m`;
    case "muted":
    case "toolDiffContext":
    case "toolOutput":
      return `\x1b[90m${text}\x1b[39m`;
    default:
      return text;
  }
}

function colorizeDiffLine(line: string, theme: any): string {
  if (line.startsWith("+++") || line.startsWith("---")) return style(theme, "muted", line);
  if (line.startsWith("+")) return style(theme, "toolDiffAdded", line);
  if (line.startsWith("-")) return style(theme, "toolDiffRemoved", line);
  if (line.startsWith("@@")) return style(theme, "accent", line);
  if (line.startsWith("diff --git")) return style(theme, "muted", line);
  return style(theme, "toolDiffContext", line);
}

function trimTrailingEmptyLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") end--;
  return lines.slice(0, end);
}

function diffLines(result: any): string[] {
  const files = Array.isArray(result?.details?.files) ? result.details.files : [];
  const lines: string[] = [];

  for (const file of files) {
    if (typeof file?.unifiedDiff !== "string" || file.unifiedDiff.trim() === "") continue;
    if (lines.length > 0) lines.push("");
    lines.push(...file.unifiedDiff.split("\n"));
  }

  if (lines.length > 0) return trimTrailingEmptyLines(lines);

  const rawLines = textContent(result).split("\n").filter((line) => line.trim() !== "");
  for (const line of rawLines) {
    if (line.startsWith("Applied patch")) continue;
    lines.push(line);
  }

  return trimTrailingEmptyLines(lines);
}

class PlainTextComponent {
  private value: string;

  constructor(value = "") {
    this.value = value;
  }

  setText(value: string) {
    this.value = value;
  }

  render(width: number): string[] {
    const safeWidth = Math.max(1, width || 80);
    const lines: string[] = [];
    for (const line of this.value.split("\n")) {
      if (line.length <= safeWidth) {
        lines.push(line);
        continue;
      }
      for (let index = 0; index < line.length; index += safeWidth) {
        lines.push(line.slice(index, index + safeWidth));
      }
    }
    return lines.length > 0 ? lines : [""];
  }

  invalidate() {}
}

function resultText(result: any, expanded: boolean, theme: any): string {
  const details = result?.details;
  const files = Array.isArray(details?.files) ? details.files : [];
  const added = Array.isArray(details?.added) ? details.added.length : 0;
  const modified = Array.isArray(details?.modified) ? details.modified.length : 0;
  const deleted = Array.isArray(details?.deleted) ? details.deleted.length : 0;

  const total = files.length || added + modified + deleted;
  const summary = total === 1 ? "1 file" : `${total} files`;
  const counts = [`A ${added}`, `M ${modified}`, `D ${deleted}`].filter((part) => !part.endsWith(" 0"));

  let text = `✓ Applied patch: ${summary}`;
  if (counts.length > 0) text += ` (${counts.join(", ")})`;

  const visibleFiles = files.slice(0, 6);
  for (const file of visibleFiles) {
    const status = file.status === "added" ? "A" : file.status === "deleted" ? "D" : "M";
    const filePath = typeof file.path === "string" ? file.path : file.moveTo || file.moveFrom || "unknown";
    const move = file.moveFrom && file.moveTo ? ` (${file.moveFrom} → ${file.moveTo})` : "";
    text += `\n  ${status} ${filePath}${move}`;
  }
  if (files.length > visibleFiles.length) {
    text += `\n  … ${files.length - visibleFiles.length} more`;
  }

  const lines = diffLines(result);
  if (lines.length > 0) {
    const maxLines = expanded ? lines.length : COLLAPSED_DIFF_LINES;
    const displayLines = lines.slice(0, maxLines);
    const remaining = lines.length - maxLines;
    text += `\n\n${displayLines.map((line) => colorizeDiffLine(line, theme)).join("\n")}`;
    if (remaining > 0) {
      text += style(theme, "muted", `\n... (${remaining} more lines, ${lines.length} total, Ctrl+O to expand)`);
    }
  }

  return text;
}

export default function (pi: ExtensionAPI) {
  const promptText = loadPromptText();
  let shouldInjectPrompt = true;

  pi.on("session_start", (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    shouldInjectPrompt = !entries.some(
      (entry) => isCustomMessageEntry(entry) && entry.customType === PROMPT_MESSAGE_TYPE,
    );
  });

  pi.on("before_agent_start", () => {
    if (!shouldInjectPrompt) return undefined;
    shouldInjectPrompt = false;
    return {
      message: {
        customType: PROMPT_MESSAGE_TYPE,
        content: promptText,
        display: false,
      },
    };
  });

  pi.registerTool({
    name: "apply_patch",
    label: "Apply Patch",
    description: "Apply a patch to files using the Codex apply_patch format.",
    parameters: Type.Object({
      input: Type.String({
        description: "Patch text starting with *** Begin Patch and ending with *** End Patch.",
      }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const result = applyPatch(params.input, ctx.cwd);
      return {
        content: [{ type: "text", text: buildToolOutput(result) }],
        details: result.details,
      };
    },
    renderResult(result, { expanded, isPartial }, _theme, context) {
      const text = (context.lastComponent as PlainTextComponent | undefined) ?? new PlainTextComponent();
      if (isPartial) {
        text.setText("Applying patch…");
        return text;
      }
      text.setText(resultText(result, expanded, _theme));
      return text;
    },
  });
}
