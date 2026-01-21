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

Skills are loaded from these directories (in order):

1. `~/.codex/skills/` — Codex user skills (recursive)
2. `~/.claude/skills/` — Claude user skills (one level deep)
3. `.claude/skills/` — Claude project skills (one level deep)
4. `~/.pi/agent/skills/` — Pi user skills (recursive)
5. `~/.pi/skills/` — Legacy user skills (recursive)
6. `.pi/skills/` — Pi project skills (recursive)

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
