# Assistant picker extension

## Summary
Add a pi extension that opens a skill-picker-style palette to browse Assistant lists and notes,
select multiple items, and inject them into the next agent prompt. The picker supports fuzzy
search, list/notes mode switching, and an option to include metadata-only or full content.
List item exports must match the Assistant web UI copy/paste formatting.

## Goals
- Provide a fast, keyboard-first palette to pull Assistant list items and notes into pi.
- Support multi-select with Space and confirm with Enter, matching skill-picker UX.
- Offer a mode toggle for metadata vs full content (JSON for lists, raw markdown for notes).
- Keep list item formatting identical to the Assistant web UI export format.

## Non-goals
- Editing, moving, or deleting lists/notes from the palette.
- Real-time sync; fetch on open is sufficient.
- Replacing existing Assistant web UI copy actions.

## Proposed solution

### Extension shape
- New extension directory under `assistant/`.
- Register the `/assistant` command to open the picker overlay.
- Store selections in extension state and inject a custom message on `before_agent_start`.

### Data sources (Assistant API)
Use Assistant's HTTP plugin endpoints:

**Lists**
- `GET /api/plugins/lists/operations/list` (lists + instance)
- `POST /api/plugins/lists/operations/items-list` (items per list)
- `POST /api/plugins/lists/operations/item-get` (full item when needed)
- Optional: `POST /api/plugins/lists/operations/items-search` (future search across lists)

**Notes**
- `GET /api/plugins/notes/operations/list` (note metadata)
- `POST /api/plugins/notes/operations/read` (full content)

All operations accept `instance_id` (default `default`). The picker should read a default
instance from config and allow a quick selector in the UI when multiple instances exist.

### UI / Interaction (skill picker style)
- Overlay UI via `ctx.ui.custom(..., { overlay: true })`.
- Layout: left sidebar for mode (**Lists** / **Notes**) and instance; main list for items.
- Keyboard
  - Up/Down: move focus
  - Space: toggle selection
  - Enter: confirm and queue
  - Tab: cycle focus between search input, list, and options row
  - Esc: cancel
- Fuzzy search input at the top (reuse `matchesKey` from skill-picker). In Lists mode,
  empty search shows the selected list, while a non-empty query searches across all lists
  (list names included in matches).
- Footer shows count + selection summary; use `ctx.ui.setStatus()` + `ctx.ui.setWidget()`.

#### Lists mode
- Sidebar lists list names; selecting a list loads its items.
- Main list shows item title + optional notes snippet (configurable).
- Selection targets list items (not list names).

#### Notes mode
- Main list shows note title + optional description/tag chips.
- Selection targets notes.

## Output formats
Two modes (toggle in UI + config default):

### Metadata mode (default)
**List items** use the exact export format from the Assistant web UI
(`packages/web-client/src/controllers/listPanelController.ts`, `buildListItemExportText`):

```
plugin: lists
itemId: <uuid>
title: <title>
notes: <notes>
url: <url>
listId: <list-id>
listName: <list-name>
instance_id: <instance>
```

Only include `notes`, `url`, `listId`, `listName`, `instance_id` when present.

**Notes** metadata block:
```
plugin: notes
title: <title>
tags: <comma-separated>
description: <description>
instance_id: <instance>
```

### Content mode
- **List items**: YAML frontmatter metadata followed by the item notes as body content.
- **Notes**: YAML frontmatter metadata + raw markdown content (same as "Copy Markdown").

## Injection strategy
- Mirror skill-picker's `before_agent_start` injection approach.
- Store selected items in extension state; clear after injection.
- Emit a custom message block with `customType: "assistant"` and `display: true`.

## Configuration
Config file: `~/.pi/agent/extensions/assistant/config.json`

```json
{
  "assistantUrl": "http://localhost:3000",
  "defaultInstance": "default",
  "includeMode": "metadata",
  "showListNotesPreview": true
}
```

Environment override:
- `ASSISTANT_URL` overrides `assistantUrl` (matches assistant-cli behavior).

No token support is required; the extension does not send auth headers.

## Error handling
- If Assistant server is unreachable, show `ctx.ui.notify()` and status text.
- If an item fails to load, skip it and surface a warning in the status widget.

## Files to update

### New
- `assistant/index.ts` - extension implementation
- `assistant/README.md` - usage + configuration
- `assistant/package.json` - extension metadata
- `assistant/theme.example.json` - optional UI theme (match skill-picker)
- `docs/design/assistant-picker.md` - design doc (this file)

### Modified
- `README.md` - add extension to list
- `CHANGELOG.md` - add entry under [Unreleased] / Added

## Implementation steps
1. Scaffold extension directory + package.json + README.
2. Implement Assistant API client (lists/notes fetch + list item/note read).
3. Build picker UI (fuzzy search, multi-select, mode switch, options row).
4. Track selection + injection via `before_agent_start`.
5. Add tests for formatting helpers and selection logic.

## Decisions
- Command name: `/assistant`.
- List content mode: full `ListItem` JSON + list metadata.
- Note content format: metadata block + raw markdown.

## Open questions
None.

## Alternatives considered
- Use assistant-cli directly: fast but less interactive UX; no fuzzy picker.
- Parse context line only: minimal but less informative for LLM (no content).

## Out of scope
- Full panel layout manager in the picker (tabs/splits).
- Real-time sync via WebSocket (HTTP fetch on open is sufficient).
- Chat streaming integration.
