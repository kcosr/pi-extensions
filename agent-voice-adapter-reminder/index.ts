import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isAvaMode, isInteractiveVoiceAdapterCommand, shouldQueueVoiceFollowUp } from "./logic.js";

type AvaMode = "off" | "auto" | "on";

const AVA_FOLLOW_UP_PROMPT =
	"Before you finish, prompt the user with agent-voice-adapter-cli.js in interactive mode (without --no-wait).";

export default function (pi: ExtensionAPI) {
	let mode: AvaMode = "auto";
	let stoppedUntilUserInput = false;
	let lastSuccessfulToolWasInteractiveVoice = false;

	const interactiveVoiceToolCalls = new Set<string>();

	pi.on("input", async (event) => {
		if (event.source !== "extension") {
			stoppedUntilUserInput = false;
		}
		return { action: "continue" };
	});

	pi.on("agent_start", async () => {
		lastSuccessfulToolWasInteractiveVoice = false;
		interactiveVoiceToolCalls.clear();
	});

	pi.on("tool_call", async (event) => {
		if (!isToolCallEventType("bash", event)) return;
		if (isInteractiveVoiceAdapterCommand(event.input.command)) {
			interactiveVoiceToolCalls.add(event.toolCallId);
		}
	});

	pi.on("tool_execution_end", async (event) => {
		const wasInteractiveVoice = interactiveVoiceToolCalls.has(event.toolCallId);
		interactiveVoiceToolCalls.delete(event.toolCallId);
		if (event.isError) return;
		lastSuccessfulToolWasInteractiveVoice = wasInteractiveVoice;
	});

	pi.on("agent_end", async () => {
		const shouldQueue = shouldQueueVoiceFollowUp({
			mode,
			stoppedUntilUserInput,
			lastSuccessfulToolWasInteractiveVoice,
		});
		if (!shouldQueue) return;

		stoppedUntilUserInput = true;
		pi.sendUserMessage(AVA_FOLLOW_UP_PROMPT);
	});

	pi.registerCommand("ava-mode", {
		description: "Set agent voice adapter mode: off, auto, on",
		handler: async (args, ctx) => {
			const value = (args ?? "").trim().toLowerCase();
			if (!value) {
				ctx.ui.notify(`ava-mode is ${mode}`, "info");
				return;
			}

			if (!isAvaMode(value)) {
				ctx.ui.notify("Usage: /ava-mode off|auto|on", "warning");
				return;
			}

			mode = value as AvaMode;
			ctx.ui.notify(`ava-mode set to ${mode}`, "info");
		},
	});

	pi.registerCommand("ava-status", {
		description: "Show agent voice adapter reminder status",
		handler: async (_args, ctx) => {
			ctx.ui.notify(
				`ava-status mode=${mode}, stoppedUntilUserInput=${stoppedUntilUserInput}, lastSuccessfulToolWasInteractiveVoice=${lastSuccessfulToolWasInteractiveVoice}`,
				"info",
			);
		},
	});

	pi.registerCommand("ava-reminder", {
		description: "Control reminder cycle (mark-stopped)",
		handler: async (args, ctx) => {
			const value = (args ?? "").trim().toLowerCase();
			if (value !== "mark-stopped") {
				ctx.ui.notify("Usage: /ava-reminder mark-stopped", "warning");
				return;
			}

			stoppedUntilUserInput = true;
			ctx.ui.notify("AVA session marked done until next user input", "info");
		},
	});

	pi.registerTool({
		name: "agent_voice_adapter_session_done",
		label: "Agent Voice Adapter Session Done",
		description: "Indicate the current agent voice adapter interaction is complete for this user request.",
		parameters: Type.Object({}),
		async execute() {
			stoppedUntilUserInput = true;
			return {
				content: [
					{ type: "text", text: "Agent voice adapter session marked done until next user input." },
				],
				details: {
					mode,
					stoppedUntilUserInput,
					lastSuccessfulToolWasInteractiveVoice,
				},
			};
		},
	});
}
