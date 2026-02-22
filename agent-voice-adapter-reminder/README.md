# agent-voice-adapter-reminder

Keep pi voice-first by nudging the agent to end with an interactive
`agent-voice-adapter-cli.js` prompt when needed.

This extension is designed for workflows using
[`kcosr/agent-voice-adapter`](https://github.com/kcosr/agent-voice-adapter).

## What it does

- Adds mode control via:
  - `/ava-mode off|auto|on`
  - `/ava-status`
  - `/ava-reminder mark-stopped`
- Adds an LLM-callable tool:
  - `agent_voice_adapter_session_done`
- On `agent_end`, conditionally sends a follow-up instruction to use
  `agent-voice-adapter-cli.js` in interactive mode.

## Mode behavior

- `off`: never auto-nudge.
- `auto` (default): nudge unless the **last successful tool call** in the run was
  interactive `agent-voice-adapter-cli(.js)` (without `--no-wait`).
- `on`: always nudge at `agent_end` (unless marked stopped).

`mark-stopped` and `agent_voice_adapter_session_done` suppress nudges until the next
real user input (`input.source !== "extension"`).

## Installation

1. Copy the extension into your pi extensions directory:

```bash
cp -R /path/to/pi-extensions/agent-voice-adapter-reminder ~/.pi/agent/extensions/agent-voice-adapter-reminder
```

2. Restart pi (or run `/reload`).

## How command detection works

Yes — because the voice interaction is invoked through the `bash` tool, the extension
inspects bash tool calls and checks whether the command contains
`agent-voice-adapter-cli` / `agent-voice-adapter-cli.js` and does **not** include
`--no-wait`.

That is currently the reliable way to identify interactive voice turns from extension
events.

## Development

Run logic tests:

```bash
cd agent-voice-adapter-reminder
npm test
```
