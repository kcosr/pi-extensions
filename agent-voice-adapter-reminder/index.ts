import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { isAvaMode, isInteractiveVoiceAdapterCommand, shouldQueueVoiceFollowUp } from "./logic.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

type AvaMode = "off" | "auto" | "on";

interface AvaConfig {
	defaultMode?: AvaMode;
	defaultMaxReminders?: number;
	defaultEndMessageEnabled?: boolean;
	defaultEndMessage?: string;
}

interface SessionState {
	mode: AvaMode;
	stoppedUntilUserInput: boolean;
	lastSuccessfulToolWasInteractiveVoice: boolean;
	interactiveVoiceToolCalls: Set<string>;
	reminderCount: number;
	maxReminders: number;
	endMessageEnabled: boolean;
	endMessage: string;
}

const AVA_FOLLOW_UP_PROMPT =
	"Before you finish, prompt the user with agent-voice-adapter-cli.js in interactive mode (without --no-wait).";

const DEFAULT_END_MESSAGE = "Agent finished";

const CONFIG_PATH = path.join(
	os.homedir(),
	".pi",
	"agent",
	"extensions",
	"agent-voice-adapter-reminder",
	"config.json",
);

function parseNonNegativeInt(value: string): number | null {
	if (!/^\d+$/.test(value)) return null;
	const parsed = Number.parseInt(value, 10);
	if (!Number.isFinite(parsed) || parsed < 0) return null;
	return parsed;
}

function parseBoolean(value: string): boolean | null {
	const normalized = value.trim().toLowerCase();
	if (["true", "1", "yes", "on", "enabled"].includes(normalized)) return true;
	if (["false", "0", "no", "off", "disabled"].includes(normalized)) return false;
	return null;
}

function parseKeyValueArgs(args: string): { key: string; value: string } | null {
	const trimmed = args.trim();
	if (!trimmed) return null;
	const splitAt = trimmed.indexOf(" ");
	if (splitAt === -1) return { key: trimmed.toLowerCase(), value: "" };
	return {
		key: trimmed.slice(0, splitAt).toLowerCase(),
		value: trimmed.slice(splitAt + 1).trim(),
	};
}

function loadConfig(): AvaConfig {
	try {
		if (!fs.existsSync(CONFIG_PATH)) return {};
		const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
		const parsed = JSON.parse(raw) as AvaConfig;
		const config: AvaConfig = {};
		if (parsed.defaultMode && isAvaMode(parsed.defaultMode)) {
			config.defaultMode = parsed.defaultMode;
		}
		if (typeof parsed.defaultMaxReminders === "number" && parsed.defaultMaxReminders >= 0) {
			config.defaultMaxReminders = Math.floor(parsed.defaultMaxReminders);
		}
		if (typeof parsed.defaultEndMessageEnabled === "boolean") {
			config.defaultEndMessageEnabled = parsed.defaultEndMessageEnabled;
		}
		if (typeof parsed.defaultEndMessage === "string" && parsed.defaultEndMessage.trim().length > 0) {
			config.defaultEndMessage = parsed.defaultEndMessage;
		}
		return config;
	} catch {
		return {};
	}
}

function saveConfig(config: AvaConfig): { success: true } | { success: false; error: string } {
	try {
		fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
		return { success: true };
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}

function getSessionKey(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? "__ephemeral__";
}

export default function (pi: ExtensionAPI) {
	const config = loadConfig();
	let defaultMode: AvaMode = config.defaultMode ?? "auto";
	let defaultMaxReminders = config.defaultMaxReminders ?? 2;
	let defaultEndMessageEnabled = config.defaultEndMessageEnabled ?? false;
	let defaultEndMessage = config.defaultEndMessage ?? DEFAULT_END_MESSAGE;

	const sessionStates = new Map<string, SessionState>();

	const getSessionState = (ctx: ExtensionContext): SessionState => {
		const key = getSessionKey(ctx);
		let state = sessionStates.get(key);
		if (!state) {
			state = {
				mode: defaultMode,
				stoppedUntilUserInput: false,
				lastSuccessfulToolWasInteractiveVoice: false,
				interactiveVoiceToolCalls: new Set<string>(),
				reminderCount: 0,
				maxReminders: defaultMaxReminders,
				endMessageEnabled: defaultEndMessageEnabled,
				endMessage: defaultEndMessage,
			};
			sessionStates.set(key, state);
		}
		return state;
	};

	const persistDefaults = (): { success: true } | { success: false; error: string } =>
		saveConfig({
			defaultMode,
			defaultMaxReminders,
			defaultEndMessageEnabled,
			defaultEndMessage,
		});

	pi.on("input", async (event, ctx) => {
		if (event.source !== "extension") {
			const state = getSessionState(ctx);
			state.stoppedUntilUserInput = false;
			state.reminderCount = 0;
		}
		return { action: "continue" };
	});

	pi.on("agent_start", async (_event, ctx) => {
		const state = getSessionState(ctx);
		state.lastSuccessfulToolWasInteractiveVoice = false;
		state.interactiveVoiceToolCalls.clear();
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!isToolCallEventType("bash", event)) return;
		if (!isInteractiveVoiceAdapterCommand(event.input.command)) return;
		const state = getSessionState(ctx);
		state.interactiveVoiceToolCalls.add(event.toolCallId);
	});

	pi.on("tool_execution_end", async (event, ctx) => {
		const state = getSessionState(ctx);
		const wasInteractiveVoice = state.interactiveVoiceToolCalls.has(event.toolCallId);
		state.interactiveVoiceToolCalls.delete(event.toolCallId);
		if (event.isError) return;
		state.lastSuccessfulToolWasInteractiveVoice = wasInteractiveVoice;
	});

	pi.on("agent_end", async (_event, ctx) => {
		const state = getSessionState(ctx);
		const shouldQueue = shouldQueueVoiceFollowUp({
			mode: state.mode,
			stoppedUntilUserInput: state.stoppedUntilUserInput,
			lastSuccessfulToolWasInteractiveVoice: state.lastSuccessfulToolWasInteractiveVoice,
			reminderCount: state.reminderCount,
			maxReminders: state.maxReminders,
		});
		if (shouldQueue) {
			state.reminderCount += 1;
			pi.sendUserMessage(AVA_FOLLOW_UP_PROMPT);
			return;
		}

		if (!state.endMessageEnabled) return;
		try {
			await pi.exec("agent-voice-adapter-cli.js", ["--no-wait", state.endMessage]);
			if (ctx.hasUI) {
				ctx.ui.notify(`agent-voice-adapter end message sent: "${state.endMessage}"`, "info");
			}
		} catch (error) {
			if (ctx.hasUI) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`AVA end-message failed: ${message}`, "warning");
			}
		}
	});

	pi.registerCommand("ava-mode", {
		description: "Set agent voice adapter mode (per-session): off, auto, on",
		handler: async (args, ctx) => {
			const state = getSessionState(ctx);
			const value = (args ?? "").trim().toLowerCase();
			if (!value) {
				ctx.ui.notify(`ava-mode is ${state.mode} (session-scoped)`, "info");
				return;
			}

			if (!isAvaMode(value)) {
				ctx.ui.notify("Usage: /ava-mode off|auto|on", "warning");
				return;
			}

			state.mode = value as AvaMode;
			ctx.ui.notify(`ava-mode set to ${state.mode} for this session`, "info");
		},
	});

	pi.registerCommand("ava-set", {
		description: "Set session config: max-reminders | end-message-enabled | end-message | mode",
		handler: async (args, ctx) => {
			const state = getSessionState(ctx);
			const parsed = parseKeyValueArgs(args ?? "");
			if (!parsed || !parsed.key) {
				ctx.ui.notify(
					"Usage: /ava-set <max-reminders|end-message-enabled|end-message|mode> <value>",
					"warning",
				);
				return;
			}

			const { key, value } = parsed;

			if (key === "max-reminders") {
				const n = parseNonNegativeInt(value);
				if (n === null) {
					ctx.ui.notify("Usage: /ava-set max-reminders <non-negative integer>", "warning");
					return;
				}
				state.maxReminders = n;
				ctx.ui.notify(`ava-set max-reminders=${state.maxReminders} (session)`, "info");
				return;
			}

			if (key === "end-message-enabled") {
				const enabled = parseBoolean(value);
				if (enabled === null) {
					ctx.ui.notify("Usage: /ava-set end-message-enabled <true|false>", "warning");
					return;
				}
				state.endMessageEnabled = enabled;
				ctx.ui.notify(`ava-set end-message-enabled=${state.endMessageEnabled} (session)`, "info");
				return;
			}

			if (key === "end-message") {
				if (!value) {
					ctx.ui.notify("Usage: /ava-set end-message <text>", "warning");
					return;
				}
				state.endMessage = value;
				ctx.ui.notify(`ava-set end-message=\"${state.endMessage}\" (session)`, "info");
				return;
			}

			if (key === "mode") {
				if (!isAvaMode(value)) {
					ctx.ui.notify("Usage: /ava-set mode <off|auto|on>", "warning");
					return;
				}
				state.mode = value as AvaMode;
				ctx.ui.notify(`ava-set mode=${state.mode} (session)`, "info");
				return;
			}

			ctx.ui.notify("Unknown key. Valid keys: max-reminders, end-message-enabled, end-message, mode", "warning");
		},
	});

	pi.registerCommand("ava-set-default", {
		description: "Set global defaults for new sessions: max-reminders | end-message-enabled | end-message | mode",
		handler: async (args, ctx) => {
			const parsed = parseKeyValueArgs(args ?? "");
			if (!parsed || !parsed.key) {
				ctx.ui.notify(
					"Usage: /ava-set-default <max-reminders|end-message-enabled|end-message|mode> <value>",
					"warning",
				);
				return;
			}

			const { key, value } = parsed;
			if (key === "max-reminders") {
				const n = parseNonNegativeInt(value);
				if (n === null) {
					ctx.ui.notify("Usage: /ava-set-default max-reminders <non-negative integer>", "warning");
					return;
				}
				defaultMaxReminders = n;
				const result = persistDefaults();
				if (!result.success) {
					ctx.ui.notify(`Failed to save config: ${result.error}`, "error");
					return;
				}
				ctx.ui.notify(`ava-set-default max-reminders=${defaultMaxReminders}`, "info");
				return;
			}

			if (key === "end-message-enabled") {
				const enabled = parseBoolean(value);
				if (enabled === null) {
					ctx.ui.notify("Usage: /ava-set-default end-message-enabled <true|false>", "warning");
					return;
				}
				defaultEndMessageEnabled = enabled;
				const result = persistDefaults();
				if (!result.success) {
					ctx.ui.notify(`Failed to save config: ${result.error}`, "error");
					return;
				}
				ctx.ui.notify(`ava-set-default end-message-enabled=${defaultEndMessageEnabled}`, "info");
				return;
			}

			if (key === "end-message") {
				if (!value) {
					ctx.ui.notify("Usage: /ava-set-default end-message <text>", "warning");
					return;
				}
				defaultEndMessage = value;
				const result = persistDefaults();
				if (!result.success) {
					ctx.ui.notify(`Failed to save config: ${result.error}`, "error");
					return;
				}
				ctx.ui.notify(`ava-set-default end-message=\"${defaultEndMessage}\"`, "info");
				return;
			}

			if (key === "mode") {
				if (!isAvaMode(value)) {
					ctx.ui.notify("Usage: /ava-set-default mode <off|auto|on>", "warning");
					return;
				}
				defaultMode = value as AvaMode;
				const result = persistDefaults();
				if (!result.success) {
					ctx.ui.notify(`Failed to save config: ${result.error}`, "error");
					return;
				}
				ctx.ui.notify(`ava-set-default mode=${defaultMode}`, "info");
				return;
			}

			ctx.ui.notify("Unknown key. Valid keys: max-reminders, end-message-enabled, end-message, mode", "warning");
		},
	});

	pi.registerCommand("ava-status", {
		description: "Show agent voice adapter reminder status for this session",
		handler: async (_args, ctx) => {
			const state = getSessionState(ctx);
			ctx.ui.notify(
				`ava-status mode=${state.mode}, defaultMode=${defaultMode}, reminderCount=${state.reminderCount}/${state.maxReminders}, defaultMaxReminders=${defaultMaxReminders}, endMessageEnabled=${state.endMessageEnabled}, defaultEndMessageEnabled=${defaultEndMessageEnabled}, endMessage=\"${state.endMessage}\", defaultEndMessage=\"${defaultEndMessage}\", stoppedUntilUserInput=${state.stoppedUntilUserInput}, lastSuccessfulToolWasInteractiveVoice=${state.lastSuccessfulToolWasInteractiveVoice}`,
				"info",
			);
		},
	});

	pi.registerCommand("ava-reminder", {
		description: "Control reminder cycle for this session (mark-stopped)",
		handler: async (args, ctx) => {
			const state = getSessionState(ctx);
			const value = (args ?? "").trim().toLowerCase();
			if (value !== "mark-stopped") {
				ctx.ui.notify("Usage: /ava-reminder mark-stopped", "warning");
				return;
			}

			state.stoppedUntilUserInput = true;
			ctx.ui.notify("AVA session marked done until next user input", "info");
		},
	});

	pi.registerTool({
		name: "agent_voice_adapter_session_done",
		label: "Agent Voice Adapter Session Done",
		description: "Indicate the current agent voice adapter interaction is complete for this user request.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const state = getSessionState(ctx);
			state.stoppedUntilUserInput = true;
			return {
				content: [
					{ type: "text", text: "Agent voice adapter session marked done until next user input." },
				],
				details: {
					mode: state.mode,
					defaultMode,
					reminderCount: state.reminderCount,
					maxReminders: state.maxReminders,
					defaultMaxReminders,
					endMessageEnabled: state.endMessageEnabled,
					defaultEndMessageEnabled,
					endMessage: state.endMessage,
					defaultEndMessage,
					stoppedUntilUserInput: state.stoppedUntilUserInput,
					lastSuccessfulToolWasInteractiveVoice: state.lastSuccessfulToolWasInteractiveVoice,
				},
			};
		},
	});
}
