# agent-voice-adapter-reminder

Keep pi voice-first by nudging the agent to end with an interactive
`agent-voice-adapter-cli.js` prompt when needed.

This extension is designed for workflows using
[`kcosr/agent-voice-adapter`](https://github.com/kcosr/agent-voice-adapter).

## What it does

- Adds mode control via:
  - `/ava-mode off|auto|on` (per-session)
  - `/ava-set default-mode <off|auto|on>`
  - `/ava-set max-reminders <n>`
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
- `on`: nudge at `agent_end` while under the session's max reminder count (unless marked stopped).

`mark-stopped` and `agent_voice_adapter_session_done` suppress nudges until the next
real user input (`input.source !== "extension"`).

Each session tracks reminder attempts and enforces a max count. The reminder counter
resets on the next real user input.

## Session scope and defaults

- `/ava-mode` is scoped to the active session.
- `/ava-set default-mode ...` sets the mode default used when a session is first seen by the extension.
- `/ava-set max-reminders ...` sets the default max reminders for new sessions.
- Defaults are saved to:
  - `~/.pi/agent/extensions/agent-voice-adapter-reminder/config.json`

## Installation

1. Copy the extension into your pi extensions directory:

```bash
cp -R /path/to/pi-extensions/agent-voice-adapter-reminder ~/.pi/agent/extensions/agent-voice-adapter-reminder
```

2. Restart pi (or run `/reload`).

## How command detection works

Yes — because the voice interaction is invoked through the `bash` tool, the extension
inspects bash tool calls and checks whether the command contains
`agent-voice-adapter-cli.js` and does **not** include `--no-wait`.

That is currently the reliable way to identify interactive voice turns from extension
events.

## Development

Run logic tests:

```bash
cd agent-voice-adapter-reminder
npm test
```
