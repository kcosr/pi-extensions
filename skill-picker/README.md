# skill-picker

> **Attribution**: Hard fork of [pi-skill-palette](https://github.com/nicobailon/pi-skill-palette) (MIT) by @nicobailon.

A command palette for selecting and queueing skills explicitly via the `/skill` command.

## Requirements

No external dependencies.

## Installation

1. Copy the extension into your pi extensions directory:
   ```bash
   cp -R /path/to/pi-extensions/skill-picker ~/.pi/agent/extensions/skill-picker
   ```
2. Restart pi (or reload extensions).

## Usage

Run the command to open the skill picker:

```
/skill
```

Queued skills are applied to your next message.

## Keyboard Shortcuts

### Skill Picker (default focus)
| Key | Action |
| --- | --- |
| `↑` / `↓` | Navigate skills |
| `Enter` | Add selected skill (if missing) and close |
| `Space` | Toggle add/remove without closing |
| `Esc` | Clear queued skills (if any) or cancel |

### Clear Queued Skills Dialog
| Key | Action |
| --- | --- |
| `Tab` | Switch buttons |
| `Enter` | Confirm selection |
| `Esc` | Cancel or confirm removal (if pressed twice) |
| `Y` / `N` | Quick confirm/cancel |

## Skill Locations

By default, skills are loaded from:

1. `~/.agents/skills/` — recursive scan for `SKILL.md`

You can override scan directories via:

`~/.pi/agent/extensions/skill-picker/config.json`

```json
{
  "skillDirs": [
    { "dir": "~/.agents/skills", "format": "recursive" }
  ]
}
```

- `dir`: absolute path or `~/...` path
- `format`:
  - `recursive` (search all subdirectories for `SKILL.md`)
  - `claude` (one level deep; each direct child directory must contain `SKILL.md`)

Each skill must live in its own directory with a `SKILL.md` that includes frontmatter:

```markdown
---
name: my-skill
description: Brief description of what this skill does
---

# Skill Content
```

## Theming

Create `~/.pi/agent/extensions/skill-picker/theme.json` to customize colors:

```json
{
  "border": "2",
  "title": "2",
  "selected": "36",
  "selectedText": "36",
  "queued": "32",
  "searchIcon": "2",
  "placeholder": "2;3",
  "description": "2",
  "hint": "2",
  "confirm": "32",
  "cancel": "31"
}
```

Color codes are ANSI escape codes (e.g., "36" = cyan, "32" = green, "34" = blue).
