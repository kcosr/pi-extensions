# codemap

> **Attribution**: Borrows heavily from [pi-skill-palette](https://github.com/nicobailon/pi-skill-palette) (MIT) by @nicobailon.

A file browser extension for pi that lets you select files and directories and prepare a `codemap` command.

## Requirements

- Install the `codemap` CLI from https://github.com/kcosr/codemap
- Ensure `codemap` is available on your `PATH`

## Installation

1. Copy the extension into your pi extensions directory:
   ```bash
   cp -R /path/to/pi-extensions/codemap ~/.pi/agent/extensions/codemap
   ```
2. Restart pi (or reload extensions).

## Usage

Run the command to open the file browser:

```
/codemap
```

When you are done selecting:
- Press `Esc` at the project root to populate the editor with the command
- Press `Enter` to execute it

On first open, you start inside the project. Use the `..` entry at the top to move to the parent view (showing the project directory name for selecting the entire project), then `Enter` to return inside.

The command uses:
- `!codemap ...` when **Share with agent** is enabled
- `!!codemap ...` when **Share with agent** is disabled

Directories are expanded to `dir/**`, and glob arguments are single-quoted to prevent shell expansion.

## Keyboard Shortcuts

### File Browser (default focus)
| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate files |
| `Enter` | Enter directory / Toggle file selection |
| `Space` | Toggle selection |
| `Backspace` | Go to parent directory (when search is empty) |
| `Escape` | Go to parent directory, or populate editor at root |
| `Tab` | Switch to options panel |
| Type | Search all files in project |

### Options Panel (Tab to focus)
| Key | Action |
|-----|--------|
| `↑` / `↓` | Navigate options |
| `Space` | Toggle checkbox on/off |
| `Enter` | Toggle checkbox, run action, or edit input field |
| `0-9` | Type directly into input field |
| `Backspace` | Delete character (when editing) |
| `Tab` / `Escape` | Return to file browser |

## Options

| Option | Description | Default |
|--------|-------------|---------|
| Respect .gitignore | Filter out files in .gitignore (git repos only) | On |
| Skip hidden files | Skip files/directories starting with `.` | On |
| Token budget | Limit output size with `-b` flag | 15000 |
| Share with agent | Use `!` (shared) or `!!` (not shared with LLM) | On |

Show dry run stats: Display the codemap stats summary for the current selection.

**Note**: Files matching `skipPatterns` in the config (default: `node_modules`) are always skipped regardless of other settings.

## Features

- **Directory navigation**: Browse into subdirectories, go back with Esc or backspace
- **Multi-select**: Select multiple files and directories
- **Global search**: Type to search all files across all subdirectories
- **Fuzzy matching**: Matches against both filename and full path
- **Glob patterns**: Auto-detects glob patterns (`*.ts`, `src/**/*.js`, `test?.ts`)
- **Gitignore support**: Respects .gitignore in git repos (Tab → Options → toggle)
- **CWD restricted**: Cannot navigate above the working directory
- **Editor integration**: Populates input with `!codemap ...` or `!!codemap ...`
- **Stats summary**: Use Tab → Show dry run stats to view codemap stats for the current selection

## Search Modes

The search auto-detects the mode based on your query:

**Fuzzy search** (no glob characters):
- `button` → matches `Button.tsx`, `IconButton.ts`, `buttons/index.ts`

**Glob patterns** (contains `*`, `?`, or `[]`):
- `*.ts` → all TypeScript files
- `*.test.ts` → all test files
- `src/**/*.tsx` → all TSX files under src (recursive)
- `component?.tsx` → matches `component1.tsx`, `componentA.tsx`
- `[A-Z]*.ts` → files starting with uppercase letter

## Configuration

Create `~/.pi/agent/extensions/codemap/config.json` to set defaults:

```json
{
  "tokenBudget": 15000,
  "respectGitignore": true,
  "shareWithAgent": true,
  "skipHidden": true,
  "skipPatterns": ["node_modules"]
}
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `tokenBudget` | `number \| null` | `15000` | Default token budget (null = disabled) |
| `respectGitignore` | `boolean` | `true` | Whether to respect .gitignore by default |
| `shareWithAgent` | `boolean` | `true` | Whether to share output with agent (`!` vs `!!`) |
| `skipHidden` | `boolean` | `true` | Whether to skip hidden files (starting with `.`) |
| `skipPatterns` | `string[]` | `["node_modules"]` | Additional patterns to always skip (supports globs) |

## Theming

Create `~/.pi/agent/extensions/codemap/theme.json` to customize colors:

```json
{
  "border": "2",
  "title": "2",
  "selected": "36",
  "selectedText": "36",
  "directory": "34",
  "checked": "32",
  "searchIcon": "2",
  "placeholder": "2;3",
  "hint": "2"
}
```

Color codes are ANSI escape codes (e.g., "36" = cyan, "32" = green, "34" = blue).
