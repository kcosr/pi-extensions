# cli-providers

Register external CLI tools (e.g. Claude CLI, Codex CLI) as pi models via an extension.

## Installation

Copy the extension into your pi extensions directory:

```bash
cp -R /path/to/pi-extensions/cli-providers ~/.pi/agent/extensions/cli-providers
```

Restart pi (or reload extensions).

## Configuration

Create `~/.pi/agent/extensions/cli-providers/config.json` based on the example:

```bash
cp /path/to/pi-extensions/cli-providers/config.example.json \
  ~/.pi/agent/extensions/cli-providers/config.json
```

### Config schema

- `providers[]`: list of provider registrations
  - `name`: provider name shown in pi
  - `api`: API identifier (default `external-cli`)
  - `baseUrl`: placeholder required by model registry (default `cli://local`)
  - `apiKey`: placeholder required by model registry (default `CLI_NO_KEY`)
  - `models[]`: standard model definitions plus a `cli` block
    - `cli.executable`: CLI binary (e.g. `claude`, `codex`)
    - `cli.args`: static args to pass every time
    - `cli.modelArg`: model name for the CLI (defaults to model id)
    - `cli.modelFlag`: flag for model selection (default `--model`)
    - `cli.thinkingFlag`: flag for thinking level (default `--thinking`; use `""` to disable)
    - `cli.sessionFlag`: flag for session id (default `--session`)
    - `cli.resumeFlag`: flag for resuming a session (e.g. `--resume`)
    - `cli.promptFlag`: flag for prompt (default `-p`; use `\"\"` for positional prompt)
    - `cli.continueFlag`: optional flag used when there is no prompt
    - `cli.outputFormat`: `jsonl` (default) or `text`
    - `cli.env`: extra environment variables
    - `cli.cwd`: working directory
    - `cli.timeoutMs`: timeout in milliseconds
    - `cli.logFile`: optional log file path for raw CLI output (stdout JSON lines; stderr prefixed)

## Usage

Select a CLI-backed model via `/model`, then chat as normal.

For debugging stream parsing, set `cli.logFile` to capture the raw JSONL output.

## Output Protocol

By default the extension expects JSONL output. It supports two event styles:

- **Pi-style events**: `message_update` with `assistantMessageEvent` (text/thinking deltas).
- **Simple events**: `{ "type": "text", "delta": "..." }` and `{ "type": "thinking", "delta": "..." }`.

Tool execution events (`tool_execution_start/end` or `tool_call/tool_result`) are rendered as custom
messages. These do **not** trigger pi tool execution.

In `jsonl` mode, non-JSON output is treated as an error (and is written to the log file if configured).

## Limitations

- Image attachments are omitted from CLI prompts (a note is emitted in the chat).
- Custom tool messages use a simple renderer; they don't currently integrate with the built-in
  tool expand/collapse toggle.
