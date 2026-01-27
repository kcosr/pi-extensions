# pi-extensions

A collection of extensions for the [pi coding agent](https://github.com/badlogic/pi-mono).

## Installation

Extensions can be installed two ways:

**Option 1: Drop in extensions folder**

Copy or symlink to `~/.pi/agent/extensions/`:

```bash
# Copy
cp -r ~/pi-extensions/toolwatch/extension ~/.pi/agent/extensions/toolwatch

# Or symlink
ln -s ~/pi-extensions/toolwatch/extension ~/.pi/agent/extensions/toolwatch
```

For extensions that live directly in this repo (e.g., `codemap/`, `skill-picker/`), copy the folder itself:

```bash
cp -r ~/pi-extensions/codemap ~/.pi/agent/extensions/codemap
```

**Option 2: Configure in settings.json**

Add paths to `~/.pi/agent/settings.json`:

```json
{
  "extensions": [
    "/path/to/my-extension",
    "/path/to/another-extension"
  ]
}
```

Reload pi after installing.

## Extensions

| Extension | Description |
|-----------|-------------|
| [codemap](codemap/) | File browser for selecting files/directories to pass to `codemap` via `/codemap`. |
| [apply-patch-tool](apply-patch-tool/) | Codex-style `apply_patch` tool with prompt guidance injection. |
| [assistant](assistant/) | Browse Assistant lists and notes with fuzzy search and inject selections via `/assistant`. |
| [skill-picker](skill-picker/) | Command palette for selecting and queueing skills explicitly via `/skill` command. Hard fork of [pi-skill-palette](https://github.com/nicobailon/pi-skill-palette). |
| [toolwatch](toolwatch/) | Tool call auditing and approval system. Log all tool calls to SQLite, block dangerous commands, require manual approval for sensitive operations. |

See each extension's README for configuration details.
