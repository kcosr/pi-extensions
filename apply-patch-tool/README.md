# apply-patch-tool

Codex-style `apply_patch` tool for pi, plus prompt guidance injection.

## Installation

Copy the extension into your pi extensions directory:

```bash
cp -R /path/to/pi-extensions/apply-patch-tool ~/.pi/agent/extensions/apply-patch-tool
```

Restart pi (or reload extensions).

## What it does

- Registers an `apply_patch` tool that accepts Codex patch text.
- Injects `apply_patch_prompt.md` once per session as a hidden custom message.
- Applies patches with Codex-compatible parsing and output summaries.
- Appends unified diffs to tool output (Codex-style).

## Prompt file

The extension loads `apply_patch_prompt.md` from the extension directory and injects it once at session start (as a persistent custom message). It is not appended to the system prompt on every turn.

## Testing

```bash
cd apply-patch-tool && npm test
```
