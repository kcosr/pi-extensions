import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import type { Message, Model } from "@mariozechner/pi-ai";
import {
	buildCliArgs,
	extractPromptText,
	resolveLogFilePath,
	truncateLines,
	queueCliToolMessage,
	flushCliToolMessages,
	updateStopReasonFromDelta,
	updateStopReasonFromDone,
	type CliInvocationConfig,
} from "./index";

describe("cli-providers helpers", () => {
	it("buildCliArgs includes model, thinking, session, and prompt flags", () => {
		const cli: CliInvocationConfig = {
			executable: "cli",
			modelFlag: "--model",
			thinkingFlag: "--thinking",
			sessionFlag: "--session",
			promptFlag: "-p",
		};
		const model = { id: "model-a", api: "external-cli", provider: "cli" } as Model<"external-cli">;
		const args = buildCliArgs(cli, model, "hello", { reasoning: "high", sessionId: "abc" }, false);
		assert.deepEqual(args, ["--model", "model-a", "--thinking", "high", "--session", "abc", "-p", "hello"]);
	});

	it("buildCliArgs uses continueFlag when prompt is empty", () => {
		const cli: CliInvocationConfig = {
			executable: "cli",
			continueFlag: "--continue",
		};
		const model = { id: "model-a", api: "external-cli", provider: "cli" } as Model<"external-cli">;
		const args = buildCliArgs(cli, model, "", undefined, false);
		assert.deepEqual(args, ["--model", "model-a", "--continue"]);
	});

	it("buildCliArgs uses resumeFlag when resumeSession is true", () => {
		const cli: CliInvocationConfig = {
			executable: "cli",
			resumeFlag: "--resume",
			sessionFlag: "--session-id",
			promptFlag: "",
		};
		const model = { id: "model-a", api: "external-cli", provider: "cli" } as Model<"external-cli">;
		const args = buildCliArgs(cli, model, "hi", { sessionId: "sess" }, true);
		assert.deepEqual(args, ["--model", "model-a", "--resume", "sess", "hi"]);
	});

	it("extractPromptText appends image placeholder", () => {
		const messages: Message[] = [
			{
				role: "user",
				content: [
					{ type: "text", text: "Hello" },
					{ type: "image", data: "abc", mimeType: "image/png" },
				],
				timestamp: 1,
			},
		];
		const info = extractPromptText(messages);
		assert.equal(info.prompt, "Hello\n[image attachment omitted]");
		assert.equal(info.imageCount, 1);
	});

	it("extractPromptText skips cli-tool custom messages", () => {
		const messages: Message[] = [
			{ role: "user", content: "first", timestamp: 1 },
			{
				role: "user",
				content: "CLI Tool\nBash (call)",
				timestamp: 2,
				customType: "cli-tool",
			} as Message,
			{ role: "user", content: "real prompt", timestamp: 3 },
		];
		const info = extractPromptText(messages);
		assert.equal(info.prompt, "real prompt");
	});

	it("truncateLines truncates long output", () => {
		const result = truncateLines("a\nb\nc", 2);
		assert.equal(result.truncated, true);
		assert.equal(result.text, "a\nb\n...");
	});

	it("resolveLogFilePath expands home and relative paths", () => {
		const home = os.homedir();
		assert.equal(resolveLogFilePath("~/logs/cli.log", "/tmp"), path.join(home, "logs", "cli.log"));
		assert.equal(resolveLogFilePath("logs/cli.log", "/tmp"), path.join("/tmp", "logs", "cli.log"));
		assert.equal(resolveLogFilePath("/var/log/cli.log", "/tmp"), "/var/log/cli.log");
	});

	it("stop reason ignores tool_use and keeps length", () => {
		assert.equal(updateStopReasonFromDelta("stop", "tool_use"), "stop");
		assert.equal(updateStopReasonFromDone("stop", "tool_use"), "stop");
		assert.equal(updateStopReasonFromDelta("stop", "max_tokens"), "length");
		assert.equal(updateStopReasonFromDone("stop", "length"), "length");
	});

	it("queues and flushes cli tool messages in order", () => {
		const queue: { toolName: string; phase: "call" | "result" }[] = [];
		const sent: string[] = [];
		queueCliToolMessage(queue, { phase: "call", toolName: "Bash" });
		queueCliToolMessage(queue, { phase: "result", toolName: "Bash" });

		flushCliToolMessages(queue, (message) => {
			sent.push(`${message.toolName}:${message.phase}`);
		});

		assert.deepEqual(sent, ["Bash:call", "Bash:result"]);
		assert.equal(queue.length, 0);
	});
});
