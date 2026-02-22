export const AVA_MODES = ["off", "auto", "on"];

const VOICE_CLI_PATTERN = /(^|[^\w-])agent-voice-adapter-cli\.js(?=$|[^\w-])/;
const NO_WAIT_PATTERN = /(^|\s)--no-wait(?=\s|$)/;

export function isInteractiveVoiceAdapterCommand(command) {
	if (typeof command !== "string") return false;
	if (!VOICE_CLI_PATTERN.test(command)) return false;
	return !NO_WAIT_PATTERN.test(command);
}

export function isAvaMode(value) {
	return AVA_MODES.includes(value);
}

export function shouldQueueVoiceFollowUp({
	mode,
	stoppedUntilUserInput,
	lastSuccessfulToolWasInteractiveVoice,
	reminderCount,
	maxReminders,
}) {
	if (mode === "off") return false;
	if (stoppedUntilUserInput) return false;
	if (Number.isFinite(maxReminders) && maxReminders >= 0 && reminderCount >= maxReminders) return false;
	if (mode === "auto" && lastSuccessfulToolWasInteractiveVoice) return false;
	return true;
}
