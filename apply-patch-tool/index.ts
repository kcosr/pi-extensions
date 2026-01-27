import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPatch } from "./patch.js";
import { buildToolOutput } from "./tool-output.js";

const PROMPT_MESSAGE_TYPE = "apply-patch-tool-instructions";
const PROMPT_FILENAME = "apply_patch_prompt.md";

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
    async execute(_toolCallId, params, _onUpdate, ctx) {
      const result = applyPatch(params.input, ctx.cwd);
      return {
        content: [{ type: "text", text: buildToolOutput(result) }],
        details: result.details,
      };
    },
  });
}
