# skill-picker

> **Attribution**: Hard fork of [pi-skill-palette](https://github.com/nicobailon/pi-skill-palette) (MIT) by @nicobailon.

Pick and queue skills explicitly via a command palette instead of relying on automatic skill invocation.

## Usage

1. Run `/skill` to open the palette.
2. Type to fuzzy-filter skills by name/description.
3. Navigate with `↑`/`↓`.
4. Press `Enter` to add the selected skill (if not already queued) and close the palette.
5. Send your next message to apply all queued skills.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `↑` / `↓` | Navigate skills |
| `Enter` | Add selected skill (if missing) and submit |
| `Space` | Toggle add/remove without closing |
| `Esc` | Clear queued skills (if any) or cancel |
| `Tab` | Switch buttons in clear/keep dialog |
| `Y` / `N` | Quick confirm/cancel dialog |

### Clear Queued Skills Dialog

- Appears when pressing `Esc` with queued skills.
- Defaults to **Remove**.
- Pressing `Esc` again confirms removal.

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

Copy `theme.example.json` to `theme.json` in this directory to customize ANSI colors.
