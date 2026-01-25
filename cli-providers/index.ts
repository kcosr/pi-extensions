/**
 * cli-providers
 *
 * Registers external CLI providers (e.g. Claude CLI, Codex CLI) as custom models.
 * Streams JSONL output and converts it into pi AssistantMessage events.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Message,
	type Model,
	type SimpleStreamOptions,
} from "@mariozechner/pi-ai";
import { Container, Markdown, Spacer, Text } from "@mariozechner/pi-tui";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface CliProvidersConfig {
	providers: CliProviderConfig[];
}

export interface CliProviderConfig {
	name: string;
	api?: string;
	baseUrl?: string;
	apiKey?: string;
	models: CliModelConfig[];
}

export interface CliModelConfig {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	cli: CliInvocationConfig;
}

export interface CliInvocationConfig {
	executable: string;
	args?: string[];
	modelArg?: string;
	modelFlag?: string;
	thinkingFlag?: string;
	promptFlag?: string;
	sessionFlag?: string;
	resumeFlag?: string;
	continueFlag?: string;
	outputFormat?: "jsonl" | "text";
	env?: Record<string, string>;
	cwd?: string;
	timeoutMs?: number;
	logFile?: string;
}

interface PromptInfo {
	prompt: string;
	imageCount: number;
}

interface CliToolMessage {
	phase: "call" | "result";
	toolName: string;
	toolCallId?: string;
	args?: unknown;
	result?: unknown;
	isError?: boolean;
	outputSnippet?: string;
	outputTruncated?: boolean;
}

interface CliLogWriter {
	write: (source: "stdout" | "stderr" | "meta", line: string) => void;
	close: () => void;
}

const CONFIG_PATH = path.join(os.homedir(), ".pi", "agent", "extensions", "cli-providers", "config.json");
const DEFAULT_CONFIG: CliProvidersConfig = { providers: [] };
const DEFAULT_BASE_URL = "cli://local";
const DEFAULT_API_KEY = "CLI_NO_KEY";
const DEFAULT_MODEL_FLAG = "--model";
const DEFAULT_THINKING_FLAG = "--thinking";
const DEFAULT_PROMPT_FLAG = "-p";
const DEFAULT_SESSION_FLAG = "--session";
const DEFAULT_OUTPUT_FORMAT: CliInvocationConfig["outputFormat"] = "jsonl";
const STDERR_LIMIT = 20_000;
const KILL_TIMEOUT_MS = 2_000;
const TOOL_OUTPUT_LINES = 12;

let extensionApi: ExtensionAPI | null = null;
const seenSessionIds = new Set<string>();
type StopReason = "stop" | "length" | "toolUse";

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function getString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

export function updateStopReasonFromDelta(current: StopReason, reason: string | undefined): StopReason {
	if (reason === "max_tokens") return "length";
	return current;
}

export function updateStopReasonFromDone(current: StopReason, reason: string | undefined): StopReason {
	if (reason === "length") return "length";
	return current;
}

export function queueCliToolMessage(queue: CliToolMessage[], message: CliToolMessage): void {
	queue.push(message);
}

export function flushCliToolMessages(queue: CliToolMessage[], send: (message: CliToolMessage) => void): void {
	if (queue.length === 0) return;
	const messages = queue.splice(0, queue.length);
	for (const message of messages) {
		send(message);
	}
}

function isCliToolMessage(message: Message): boolean {
	return (message as { customType?: string }).customType === "cli-tool";
}

export function resolveLogFilePath(logFile: string, cwd: string): string {
	const trimmed = logFile.trim();
	if (!trimmed) return trimmed;
	if (trimmed === "~") return os.homedir();
	if (trimmed.startsWith("~/")) {
		return path.join(os.homedir(), trimmed.slice(2));
	}
	if (path.isAbsolute(trimmed)) return trimmed;
	return path.resolve(cwd, trimmed);
}

function loadConfig(): CliProvidersConfig {
	try {
		if (fs.existsSync(CONFIG_PATH)) {
			const content = fs.readFileSync(CONFIG_PATH, "utf-8");
			const parsed = JSON.parse(content) as Partial<CliProvidersConfig>;
			const providers = Array.isArray(parsed.providers) ? parsed.providers : [];
			return { providers };
		}
	} catch {
		// Ignore config errors, fall back to defaults
	}
	return DEFAULT_CONFIG;
}

export function extractPromptText(messages: Message[]): PromptInfo {
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (isCliToolMessage(message)) continue;
		if (message.role !== "user") continue;

		if (typeof message.content === "string") {
			return { prompt: message.content, imageCount: 0 };
		}

		const parts: string[] = [];
		let imageCount = 0;
		for (const item of message.content) {
			if (item.type === "text") {
				parts.push(item.text);
			} else if (item.type === "image") {
				imageCount += 1;
			}
		}
		if (imageCount > 0) {
			parts.push(imageCount === 1 ? "[image attachment omitted]" : `[${imageCount} image attachments omitted]`);
		}

		return { prompt: parts.join("\n"), imageCount };
	}

	return { prompt: "", imageCount: 0 };
}

export function truncateLines(text: string, maxLines: number): { text: string; truncated: boolean } {
	const lines = text.split("\n");
	if (lines.length <= maxLines) {
		return { text, truncated: false };
	}
	return { text: [...lines.slice(0, maxLines), "..."].join("\n"), truncated: true };
}

export function buildCliArgs(
	cli: CliInvocationConfig,
	model: Model<Api>,
	prompt: string,
	options: SimpleStreamOptions | undefined,
	resumeSession: boolean,
): string[] {
	const args = [...(cli.args ?? [])];

	const modelFlag = cli.modelFlag ?? DEFAULT_MODEL_FLAG;
	const modelArg = cli.modelArg ?? model.id;
	if (modelFlag && modelArg) {
		args.push(modelFlag, modelArg);
	}

	const reasoning = options?.reasoning;
	const thinkingFlag = cli.thinkingFlag ?? DEFAULT_THINKING_FLAG;
	if (reasoning && thinkingFlag) {
		args.push(thinkingFlag, reasoning);
	}

	const sessionId = options?.sessionId;
	const sessionFlag = cli.sessionFlag ?? DEFAULT_SESSION_FLAG;
	const resumeFlag = cli.resumeFlag ?? cli.continueFlag;
	if (sessionId) {
		if (resumeSession && resumeFlag) {
			args.push(resumeFlag, sessionId);
		} else if (!resumeSession && sessionFlag) {
			args.push(sessionFlag, sessionId);
		}
	}

	if (prompt) {
		const promptFlag = cli.promptFlag ?? DEFAULT_PROMPT_FLAG;
		if (promptFlag) {
			args.push(promptFlag, prompt);
		} else {
			args.push(prompt);
		}
	} else if (cli.continueFlag) {
		args.push(cli.continueFlag);
	}

	return args;
}

function shouldResumeSession(sessionId: string | undefined, context: Context): boolean {
	if (!sessionId) return false;
	if (seenSessionIds.has(sessionId)) return true;

	let userCount = 0;
	for (const message of context.messages) {
		if (isCliToolMessage(message)) continue;
		if (message.role === "assistant" || message.role === "toolResult") {
			return true;
		}
		if (message.role === "user") {
			userCount += 1;
		}
	}

	return userCount > 1;
}

function createOutputMessage(model: Model<Api>): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: Date.now(),
	};
}

function sendCliToolMessage(message: CliToolMessage): void {
	if (!extensionApi) return;
	const statusLabel = message.phase === "call" ? "call" : message.isError ? "error" : "done";
	const summaryParts = [`${message.toolName} (${statusLabel})`];
	if (message.args && message.phase === "call") {
		const argsText = formatInlineJson(message.args, 180);
		if (argsText) summaryParts.push(`args: ${argsText}`);
	}
	if (message.outputSnippet) {
		summaryParts.push(message.outputSnippet);
	}
	if (message.outputTruncated) {
		summaryParts.push("[output truncated]");
	}
	const summary = summaryParts.join("\n");

	extensionApi.sendMessage({
		customType: "cli-tool",
		content: summary,
		display: true,
		details: message,
	});
}

function formatInlineJson(value: unknown, maxLength: number): string | undefined {
	try {
		const text = JSON.stringify(value);
		if (!text) return undefined;
		return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
	} catch {
		return undefined;
	}
}

function createCliLogWriter(
	cli: CliInvocationConfig,
	model: Model<Api>,
	sessionId: string | undefined,
	resumeSession: boolean,
): CliLogWriter | null {
	const logFile = cli.logFile?.trim();
	if (!logFile) return null;

	const resolvedPath = resolveLogFilePath(logFile, cli.cwd ?? process.cwd());
	try {
		fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
	} catch {
		// ignore mkdir errors; write stream will fail if path is invalid
	}

	let stream: fs.WriteStream;
	try {
		stream = fs.createWriteStream(resolvedPath, { flags: "a" });
	} catch {
		return null;
	}

	stream.on("error", () => {
		// swallow log errors to avoid breaking the stream
	});

	const writeRawLine = (line: string) => {
		if (!line) return;
		if (line.endsWith("\n")) {
			stream.write(line);
		} else {
			stream.write(line + "\n");
		}
	};

	const writeLines = (value: string, prefix?: string) => {
		const lines = value.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line === "" && i === lines.length - 1) continue;
			writeRawLine(prefix ? `${prefix}${line}` : line);
		}
	};

	const write = (source: "stdout" | "stderr" | "meta", line: string) => {
		if (!line) return;
		if (source === "stdout") {
			writeLines(line);
			return;
		}
		if (source === "stderr") {
			writeLines(line, "# stderr: ");
			return;
		}
		writeLines(line, "# ");
	};

	write("meta", `--- ${new Date().toISOString()} model=${model.id} session=${sessionId ?? "none"} resume=${resumeSession}`);

	return {
		write,
		close: () => {
			stream.end();
		},
	};
}

function extractToolOutput(result: unknown): string | undefined {
	if (typeof result === "string") return result;
	if (!isRecord(result)) return undefined;

	const content = result.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const parts: string[] = [];
		for (const entry of content) {
			if (isRecord(entry) && entry.type === "text" && typeof entry.text === "string") {
				parts.push(entry.text);
			}
		}
		return parts.join("\n");
	}
	return undefined;
}

function streamExternalCli(
	model: Model<Api>,
	context: Context,
	options: SimpleStreamOptions | undefined,
	cli: CliInvocationConfig,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createOutputMessage(model);
		stream.push({ type: "start", partial: output });

		let aborted = false;
		let timedOut = false;
		let stderrBuffer = "";
		let stopReason: StopReason = "stop";
		let receivedText = false;
		const pendingToolMessages: CliToolMessage[] = [];

		const enqueueToolMessage = (message: CliToolMessage) => {
			queueCliToolMessage(pendingToolMessages, message);
		};

		const scheduleToolFlush = () => {
			if (pendingToolMessages.length === 0) return;
			setTimeout(() => {
				if (!extensionApi) return;
				flushCliToolMessages(pendingToolMessages, sendCliToolMessage);
			}, 0);
		};

		const { prompt, imageCount } = extractPromptText(context.messages);
		if (imageCount > 0) {
			enqueueToolMessage({
				phase: "result",
				toolName: "attachments",
				isError: false,
				outputSnippet: "Images were omitted from CLI prompt.",
			});
		}

		const sessionId = options?.sessionId;
		const resumeSession = shouldResumeSession(sessionId, context);
		if (sessionId) {
			seenSessionIds.add(sessionId);
		}
		const logWriter = createCliLogWriter(cli, model, sessionId, resumeSession);
		const args = buildCliArgs(cli, model, prompt, options, resumeSession);
		const child = spawn(cli.executable, args, {
			cwd: cli.cwd ?? process.cwd(),
			env: { ...process.env, ...(cli.env ?? {}) },
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		const toolCalls = new Map<string, { name: string; args?: unknown }>();
		const pendingToolCalls = new Map<number, { toolUseId?: string; name?: string; inputJson: string }>();

		const killTimer = { current: undefined as NodeJS.Timeout | undefined };
		const timeoutTimer = { current: undefined as NodeJS.Timeout | undefined };
		const killChild = () => {
			if (child.killed) return;
			child.kill("SIGTERM");
			killTimer.current = setTimeout(() => {
				if (!child.killed) {
					child.kill("SIGKILL");
				}
			}, KILL_TIMEOUT_MS);
		};

		const abortHandler = () => {
			aborted = true;
			killChild();
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				abortHandler();
			} else {
				options.signal.addEventListener("abort", abortHandler);
			}
		}

		if (child.stderr) {
			child.stderr.on("data", (chunk: Buffer) => {
				logWriter?.write("stderr", chunk.toString("utf-8"));
				if (stderrBuffer.length >= STDERR_LIMIT) return;
				stderrBuffer += chunk.toString("utf-8");
				if (stderrBuffer.length > STDERR_LIMIT) {
					stderrBuffer = stderrBuffer.slice(0, STDERR_LIMIT);
				}
			});
		}

		if (cli.timeoutMs && cli.timeoutMs > 0) {
			timeoutTimer.current = setTimeout(() => {
				timedOut = true;
				killChild();
			}, cli.timeoutMs);
		}

		let textIndex: number | null = null;
		let thinkingIndex: number | null = null;

		const beginText = (): number => {
			const index = output.content.length;
			output.content.push({ type: "text", text: "" });
			stream.push({ type: "text_start", contentIndex: index, partial: output });
			textIndex = index;
			return index;
		};

		const beginThinking = (): number => {
			const index = output.content.length;
			output.content.push({ type: "thinking", thinking: "" });
			stream.push({ type: "thinking_start", contentIndex: index, partial: output });
			thinkingIndex = index;
			return index;
		};

		const appendText = (delta: string) => {
			const index = textIndex ?? beginText();
			const block = output.content[index];
			if (block && block.type === "text") {
				block.text += delta;
				receivedText = true;
				stream.push({ type: "text_delta", contentIndex: index, delta, partial: output });
			}
		};

		const appendThinking = (delta: string) => {
			const index = thinkingIndex ?? beginThinking();
			const block = output.content[index];
			if (block && block.type === "thinking") {
				block.thinking += delta;
				stream.push({ type: "thinking_delta", contentIndex: index, delta, partial: output });
			}
		};

		const endText = () => {
			if (textIndex === null) return;
			const block = output.content[textIndex];
			if (block && block.type === "text") {
				stream.push({ type: "text_end", contentIndex: textIndex, content: block.text, partial: output });
			}
			textIndex = null;
		};

		const endThinking = () => {
			if (thinkingIndex === null) return;
			const block = output.content[thinkingIndex];
			if (block && block.type === "thinking") {
				stream.push({ type: "thinking_end", contentIndex: thinkingIndex, content: block.thinking, partial: output });
			}
			thinkingIndex = null;
		};

		const handleToolResult = (toolName: string, toolCallId: string | undefined, result: unknown, isError: boolean) => {
			const outputText = extractToolOutput(result);
			const snippetInfo = outputText ? truncateLines(outputText, TOOL_OUTPUT_LINES) : undefined;
			enqueueToolMessage({
				phase: "result",
				toolName,
				toolCallId,
				args: toolCallId ? toolCalls.get(toolCallId)?.args : undefined,
				result,
				isError,
				outputSnippet: snippetInfo?.text,
				outputTruncated: snippetInfo?.truncated,
			});
		};

		const emitToolCallStart = (toolName: string, toolCallId: string | undefined, args: unknown) => {
			if (toolCallId) {
				const existing = toolCalls.get(toolCallId);
				if (existing) return;
				toolCalls.set(toolCallId, { name: toolName, args });
			}
			enqueueToolMessage({ phase: "call", toolName, toolCallId, args });
		};

		const handleAssistantEvent = (event: Record<string, unknown>) => {
			const eventType = getString(event.type);
			switch (eventType) {
				case "text_start":
					beginText();
					break;
				case "text_delta": {
					const delta = getString(event.delta);
					if (delta) appendText(delta);
					break;
				}
				case "text_end":
					endText();
					break;
				case "thinking_start":
					beginThinking();
					break;
				case "thinking_delta": {
					const delta = getString(event.delta);
					if (delta) appendThinking(delta);
					break;
				}
				case "thinking_end":
					endThinking();
					break;
				case "toolcall_end": {
					const toolCall = getRecord(event.toolCall);
					const toolName = toolCall ? getString(toolCall.name) ?? "tool" : "tool";
					const toolCallId = toolCall ? getString(toolCall.id) : undefined;
					const args = toolCall ? toolCall.arguments : undefined;
					emitToolCallStart(toolName, toolCallId, args);
					break;
				}
				default:
					break;
			}
		};

		const handleJsonlEvent = (value: unknown) => {
			if (!isRecord(value)) return;

			const coreEvent =
				getString(value.type) === "stream_event" && isRecord(value.event) ? (value.event as Record<string, unknown>) : value;
			const type = getString(coreEvent.type);
			if (!type) return;

			switch (type) {
				case "message_update": {
					const inner = getRecord(coreEvent.assistantMessageEvent);
					if (inner) handleAssistantEvent(inner);
					break;
				}
				case "text": {
					const delta = getString(coreEvent.delta);
					if (delta) appendText(delta);
					break;
				}
				case "thinking": {
					const delta = getString(coreEvent.delta);
					if (delta) appendThinking(delta);
					break;
				}
				case "tool_execution_start": {
					const toolName = getString(coreEvent.toolName) ?? "tool";
					const toolCallId = getString(coreEvent.toolCallId);
					const args = coreEvent.args;
					emitToolCallStart(toolName, toolCallId, args);
					break;
				}
				case "tool_execution_end": {
					const toolName = getString(coreEvent.toolName) ?? "tool";
					const toolCallId = getString(coreEvent.toolCallId);
					const result = coreEvent.result;
					const isError = Boolean(coreEvent.isError);
					handleToolResult(toolName, toolCallId, result, isError);
					break;
				}
				case "tool_call": {
					const toolName = getString(coreEvent.name) ?? "tool";
					const toolCallId = getString(coreEvent.id);
					const args = coreEvent.arguments;
					emitToolCallStart(toolName, toolCallId, args);
					break;
				}
				case "tool_result": {
					const toolCallId = getString(coreEvent.id);
					const toolName = toolCallId ? toolCalls.get(toolCallId)?.name ?? "tool" : "tool";
					const result = coreEvent.content ?? coreEvent.result;
					handleToolResult(toolName, toolCallId, result, Boolean(coreEvent.isError));
					break;
				}
				case "assistant": {
					const message = getRecord(coreEvent.message);
					const content = message ? (message.content as unknown) : undefined;
					if (Array.isArray(content)) {
						for (const block of content) {
							if (!isRecord(block)) continue;
							const blockType = getString(block.type);
							if (blockType === "tool_use") {
								const toolName = getString(block.name) ?? "tool";
								const toolCallId = getString(block.id);
								emitToolCallStart(toolName, toolCallId, block.input);
							} else if (blockType === "text") {
								const text = getString(block.text);
								if (text && !receivedText) {
									appendText(text);
								}
							}
						}
					}
					break;
				}
				case "user": {
					const message = getRecord(coreEvent.message);
					const content = message ? (message.content as unknown) : undefined;
					if (Array.isArray(content)) {
						for (const block of content) {
							if (!isRecord(block)) continue;
							if (getString(block.type) === "tool_result") {
								const toolCallId = getString(block.tool_use_id);
								const toolName = toolCallId ? toolCalls.get(toolCallId)?.name ?? "tool" : "tool";
								const result = block.content ?? block.result;
								handleToolResult(toolName, toolCallId, result, Boolean(block.is_error));
							}
						}
					}
					break;
				}
				case "content_block_start": {
					const indexRaw = coreEvent.index;
					const index = typeof indexRaw === "number" ? indexRaw : -1;
					const contentBlock = getRecord(coreEvent.content_block);
					if (contentBlock) {
						const blockType = getString(contentBlock.type);
						if (blockType === "tool_use" || blockType === "server_tool_use") {
							const toolName = getString(contentBlock.name) ?? "tool";
							const toolCallId = getString(contentBlock.id);
							const input = contentBlock.input;
							const hasInput =
								input !== undefined &&
								input !== null &&
								!(typeof input === "object" && Object.keys(input as object).length === 0);
							if (hasInput) {
								emitToolCallStart(toolName, toolCallId, input);
							} else if (index >= 0) {
								pendingToolCalls.set(index, { toolUseId: toolCallId, name: toolName, inputJson: "" });
							}
						}
					}
					break;
				}
				case "content_block_delta": {
					const delta = getRecord(coreEvent.delta);
					const deltaType = delta ? getString(delta.type) : undefined;
					if (deltaType === "text_delta") {
						const text = getString(delta?.text);
						if (text) appendText(text);
					} else if (deltaType === "thinking_delta") {
						const thinking = getString(delta?.thinking);
						if (thinking) appendThinking(thinking);
					} else if (deltaType === "input_json_delta") {
						const indexRaw = coreEvent.index;
						const index = typeof indexRaw === "number" ? indexRaw : -1;
						const pending = pendingToolCalls.get(index);
						if (pending) {
							const partial = getString(delta?.partial_json);
							if (partial) pending.inputJson += partial;
						}
					}
					break;
				}
				case "content_block_stop": {
					const indexRaw = coreEvent.index;
					const index = typeof indexRaw === "number" ? indexRaw : -1;
					const pending = pendingToolCalls.get(index);
					if (pending) {
						pendingToolCalls.delete(index);
						let input: Record<string, unknown> = {};
						if (pending.inputJson) {
							try {
								input = JSON.parse(pending.inputJson) as Record<string, unknown>;
							} catch {
								input = {};
							}
						}
						emitToolCallStart(pending.name ?? "tool", pending.toolUseId, input);
					}
					break;
				}
				case "message_delta": {
					const delta = getRecord(coreEvent.delta);
					const reason = delta ? getString(delta.stop_reason) : undefined;
					stopReason = updateStopReasonFromDelta(stopReason, reason);
					break;
				}
				case "result": {
					const resultText = getString(coreEvent.result);
					if (resultText && !receivedText) {
						appendText(resultText);
					}
					break;
				}
				case "done": {
					const reason = getString(coreEvent.reason);
					stopReason = updateStopReasonFromDone(stopReason, reason);
					break;
				}
				default:
					break;
			}
		};

		const processJsonl = async () => {
			if (!child.stdout) return;
			const reader = createInterface({ input: child.stdout, crlfDelay: Infinity });
			for await (const line of reader) {
				logWriter?.write("stdout", line);
				const trimmed = line.trim();
				if (!trimmed) continue;
				try {
					const parsed = JSON.parse(trimmed) as unknown;
					handleJsonlEvent(parsed);
				} catch {
					logWriter?.write("meta", `non-json: ${trimmed}`);
					const snippet = trimmed.length > 400 ? `${trimmed.slice(0, 400)}…` : trimmed;
					throw new Error(`Unexpected CLI output (non-JSON): ${snippet}`);
				}
			}
		};

		const processText = async () => {
			if (!child.stdout) return;
			for await (const chunk of child.stdout) {
				const text = chunk.toString("utf-8");
				logWriter?.write("stdout", text);
				appendText(text);
			}
		};

		try {
			const exitPromise = new Promise<number>((resolve) => {
				child.on("close", (code) => resolve(code ?? 0));
			});

			if (cli.outputFormat === "text") {
				await processText();
			} else {
				await processJsonl();
			}

			const exitCode = await exitPromise;

			if ((exitCode !== 0 || timedOut) && !aborted) {
				const message = timedOut
					? `CLI timed out after ${cli.timeoutMs}ms`
					: stderrBuffer.trim() || `CLI exited with code ${exitCode}`;
				throw new Error(message);
			}

			output.stopReason = stopReason;
			stream.push({ type: "done", reason: stopReason, message: output });
		} catch (error) {
			if (!aborted) {
				killChild();
			}
			output.stopReason = aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
		} finally {
			if (options?.signal) {
				options.signal.removeEventListener("abort", abortHandler);
			}
			if (killTimer.current) {
				clearTimeout(killTimer.current);
			}
			if (timeoutTimer.current) {
				clearTimeout(timeoutTimer.current);
			}
			logWriter?.close();
			scheduleToolFlush();
		}
	})();

	return stream;
}

export default function cliProvidersExtension(pi: ExtensionAPI): void {
	extensionApi = pi;

	pi.on("context", (event) => {
		const filtered = event.messages.filter((message) => {
			return !isCliToolMessage(message as Message);
		});
		return { messages: filtered };
	});

	pi.registerMessageRenderer("cli-tool", (message, _options, theme) => {
		const container = new Container();
		container.addChild(new Spacer(1));
		const header = theme.fg("toolTitle", "CLI Tool");
		container.addChild(new Text(header, 0, 0));
		container.addChild(new Spacer(1));
		container.addChild(new Markdown(message.content, 0, 0));
		return container;
	});

	const config = loadConfig();
	for (const provider of config.providers) {
		const api = provider.api ?? "external-cli";
		const baseUrl = provider.baseUrl ?? DEFAULT_BASE_URL;
		const apiKey = provider.apiKey ?? DEFAULT_API_KEY;
		const models = provider.models ?? [];
		const cliByModel = new Map<string, CliInvocationConfig>();

		for (const model of models) {
			cliByModel.set(model.id, {
				...model.cli,
				modelFlag: model.cli.modelFlag ?? DEFAULT_MODEL_FLAG,
				thinkingFlag: model.cli.thinkingFlag ?? DEFAULT_THINKING_FLAG,
				promptFlag: model.cli.promptFlag ?? DEFAULT_PROMPT_FLAG,
				sessionFlag: model.cli.sessionFlag ?? DEFAULT_SESSION_FLAG,
				outputFormat: model.cli.outputFormat ?? DEFAULT_OUTPUT_FORMAT,
			});
		}

		pi.registerProvider(provider.name, {
			api,
			baseUrl,
			apiKey,
			models,
			streamSimple: (model, context, options) => {
				const cli = cliByModel.get(model.id);
				if (!cli) {
					const stream = createAssistantMessageEventStream();
					const output = createOutputMessage(model);
					output.stopReason = "error";
					output.errorMessage = `No CLI config found for model ${model.id}`;
					stream.push({ type: "error", reason: "error", error: output });
					return stream;
				}
				return streamExternalCli(model, context, options, cli);
			},
		});
	}
}
