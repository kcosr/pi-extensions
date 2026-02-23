# agent-voice-adapter-reminder

Keep pi voice-first by nudging the agent to end with an interactive
`agent-voice-adapter-cli.js` prompt when needed.

This extension is designed for workflows using
[`kcosr/agent-voice-adapter`](https://github.com/kcosr/agent-voice-adapter).

## Feature summary

- Adds mode and settings control via:
  - `/ava-mode off|auto|on` (per-session)
  - `/ava-set <key> <value>` (per-session)
  - `/ava-set-default <key> <value>` (global defaults for new sessions)
  - `/ava-status`
  - `/ava-reminder mark-stopped`
- Adds an LLM-callable tool:
  - `agent_voice_adapter_session_done`
- On `agent_end`, either:
  - sends a reminder prompt (if reminder conditions match), or
  - sends a one-shot end message via `agent-voice-adapter-cli.js --no-wait` when reminders are not sent and end-message is enabled.

## Keys for `/ava-set` and `/ava-set-default`

- `mode` -> `off|auto|on`
- `max-reminders` -> non-negative integer
- `end-message-enabled` -> `true|false` (also accepts `on/off`, `yes/no`, `1/0`)
- `end-message` -> text

Examples:

```text
/ava-set max-reminders 3
/ava-set end-message-enabled true
/ava-set end-message Agent finished

/ava-set-default mode auto
/ava-set-default max-reminders 2
/ava-set-default end-message-enabled false
/ava-set-default end-message Agent finished
```

## Mode behavior

- `off`: never auto-remind.
- `auto` (default): remind unless the **last successful tool call** in the run was
  interactive `agent-voice-adapter-cli.js` (without `--no-wait`).
- `on`: remind at `agent_end` while under the session's max reminder count (unless marked stopped).

`mark-stopped` and `agent_voice_adapter_session_done` suppress reminders until the next
real user input (`input.source !== "extension"`).

Each session tracks reminder attempts and enforces a max count. The reminder counter
resets on the next real user input.

## Defaults

Global defaults are saved to:

- `~/.pi/agent/extensions/agent-voice-adapter-reminder/config.json`

Default values:

- `defaultMode`: `auto`
- `defaultMaxReminders`: `2`
- `defaultEndMessageEnabled`: `false`
- `defaultEndMessage`: `"Agent finished"`

## Persistence behavior

- Global defaults (`/ava-set-default ...`) are persisted to disk in `config.json`.
- Session values (`/ava-set ...`, `/ava-mode ...`, reminder counters, stopped flag) are in-memory for the active runtime.
- Session values are not currently restored after a pi restart.

## Future enhancements

- Persist session-scoped settings/state via session custom entries (`appendEntry`) so they survive restarts.
- Add a small TUI settings panel for live rule/session editing without command memorization.
- Expand from AVA-specific behavior to a generic `session-followup-rules` engine with configurable match rules.

## Installation

1. Copy the extension into your pi extensions directory:

```bash
cp -R /path/to/pi-extensions/agent-voice-adapter-reminder ~/.pi/agent/extensions/agent-voice-adapter-reminder
```

2. Restart pi (or run `/reload`).

## How command detection works

Because the voice interaction is invoked through the `bash` tool, the extension
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
