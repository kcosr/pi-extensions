# assistant

A command palette for selecting Assistant list items and notes and injecting them into the next
agent prompt via the `/assistant` command.

## Requirements

- Assistant app from `https://github.com/kcosr/assistant` running with `lists` and `notes` plugins enabled.
- Set `ASSISTANT_URL` or `assistantUrl` in the config.

## Installation

1. Copy the extension into your pi extensions directory:
   ```bash
   cp -R /path/to/pi-extensions/assistant ~/.pi/agent/extensions/assistant
   ```
2. Restart pi (or reload extensions).

## Usage

Open the picker:

```
/assistant
```

Selected items are inserted into the editor; press Enter to send.

If a selected instance is only available for lists or notes, the other section will appear empty.

In Lists mode, an empty search shows items from the selected list. Typing a query searches across
all lists in the selected scope when **List = All lists** (list names are included in matches).
Use the List menu to drill into a specific list.

Set **Instance = All instances** for cross-instance search (type a query to see results).

The picker remembers the last mode, include setting, instance, and list in
`~/.pi/agent/extensions/assistant/state.json`.

## Keyboard Shortcuts

| Key | Action |
| --- | --- |
| `Up` / `Down` | Navigate entries |
| `Space` | Toggle selection |
| `Enter` | Insert selection and close (adds current row if not selected) |
| `Tab` | Toggle options focus |
| `Esc` | Close |

### Options Menu
When focus is on the options row, press `Enter` on **List**, **Instance**, or **Include** to open a picker.

## Output Modes

- **Metadata** (default)
  - List items are formatted like the Assistant web UI copy/paste export.
  - Notes include a metadata block (title, tags, description).
- **Content**
  - List items include YAML frontmatter metadata and notes content (if present).
  - Notes include YAML frontmatter metadata plus raw markdown content.

## Configuration

Create `~/.pi/agent/extensions/assistant/config.json`:

```json
{
  "assistantUrl": "http://localhost:3000",
  "defaultInstance": "default",
  "includeMode": "metadata",
  "showListNotesPreview": true
}
```

Environment override:
- `ASSISTANT_URL` overrides `assistantUrl`.

## Theming

Create `~/.pi/agent/extensions/assistant/theme.json` to customize colors:

```json
{
  "border": "2",
  "title": "2",
  "selected": "36",
  "selectedText": "36",
  "placeholder": "2",
  "hint": "2",
  "option": "2",
  "optionSelected": "36"
}
```

Color codes are ANSI escape codes (e.g., "36" = cyan).

## Testing

Run the format helper tests:

```bash
node --test assistant/format.test.js
```
