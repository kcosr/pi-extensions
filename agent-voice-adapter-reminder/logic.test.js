import assert from "node:assert/strict";
import test from "node:test";
import { isInteractiveVoiceAdapterCommand, shouldQueueVoiceFollowUp } from "./logic.js";

test("detects interactive agent-voice-adapter CLI command", () => {
	assert.equal(isInteractiveVoiceAdapterCommand('agent-voice-adapter-cli.js "Hello"'), true);
	assert.equal(isInteractiveVoiceAdapterCommand('agent-voice-adapter-cli "Hello"'), true);
});

test("treats --no-wait as non-interactive", () => {
	assert.equal(isInteractiveVoiceAdapterCommand('agent-voice-adapter-cli.js --no-wait "Done"'), false);
	assert.equal(isInteractiveVoiceAdapterCommand('agent-voice-adapter-cli --no-wait "Done"'), false);
});

test("ignores unrelated bash commands", () => {
	assert.equal(isInteractiveVoiceAdapterCommand('echo "hello"'), false);
	assert.equal(isInteractiveVoiceAdapterCommand(""), false);
});

test("queues in auto mode when last successful tool was not interactive voice", () => {
	assert.equal(
		shouldQueueVoiceFollowUp({
			mode: "auto",
			stoppedUntilUserInput: false,
			lastSuccessfulToolWasInteractiveVoice: false,
		}),
		true,
	);
});

test("does not queue in auto mode when last successful tool was interactive voice", () => {
	assert.equal(
		shouldQueueVoiceFollowUp({
			mode: "auto",
			stoppedUntilUserInput: false,
			lastSuccessfulToolWasInteractiveVoice: true,
		}),
		false,
	);
});

test("does not queue when stopped until user input", () => {
	assert.equal(
		shouldQueueVoiceFollowUp({
			mode: "on",
			stoppedUntilUserInput: true,
			lastSuccessfulToolWasInteractiveVoice: false,
		}),
		false,
	);
});

test("off mode never queues", () => {
	assert.equal(
		shouldQueueVoiceFollowUp({
			mode: "off",
			stoppedUntilUserInput: false,
			lastSuccessfulToolWasInteractiveVoice: false,
		}),
		false,
	);
});
