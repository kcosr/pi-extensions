# Changelog

## [Unreleased]

### Breaking Changes

### Added
- **assistant**: Add Assistant list/notes picker with metadata/content injection via `/assistant`
- **toolwatch**: Local rules evaluation mode
  - New `common/` module with shared types and rules engine
  - Extension now supports `rules.mode: "local"` for local policy enforcement without collector
  - Local manual approval plugin (`builtin:manual`) using TUI confirmation dialogs
  - Separated concerns: `rules` config (local/remote/none) vs `audit` config (none/file/http/both/http-with-fallback)
  - Legacy config format auto-converted to new format
  - Design document at `toolwatch/docs/design/local-rules.md`
  - Bundled distribution via `npm run dist` (no npm install required at destination)
- **toolwatch**: Collector accepts audit-only HTTP events (`X-Toolwatch-Audit: true`) and records them as approved without rule evaluation

### Changed
- **assistant**: Add list/instance/include pickers, scoped search with all-list/instance modes, and persisted picker state
- **assistant**: Insert selections into the editor on confirm (codemap-style Enter behavior)
- **assistant**: Include list item custom fields in injected metadata/content blocks
- **assistant**: Format list item notes with User/Agent headings and expand custom fields into frontmatter keys
- **toolwatch**: Refactored extension and collector to use shared `common` module
  - Types, rules engine, and plugin loader extracted to `@pi-extensions/toolwatch-common`
  - Extension restructured into `src/` subdirectory with config, evaluator, audit modules

### Fixed
- **toolwatch**: Plugin errors now caught and return default-deny instead of crashing
- **toolwatch**: Remote rules mode writes audit files for `file`/`both` and uses fallback files only when HTTP evaluation fails for `http-with-fallback`

### Removed

## [0.2.3] - 2026-01-23

### Added
- **codemap**: Add configurable `skipHidden` option to show/hide hidden files (default: true)
- **codemap**: Add configurable `skipPatterns` option to exclude directories/files (default: `["node_modules"]`, supports globs)
- **codemap**: Add "Skip hidden files" toggle in options panel

## [0.2.2] - 2026-01-22

### Added
- **codemap**: Add stats summary modal in the options panel (Dry run stats) using codemap JSON stats output

## [0.2.1] - 2026-01-21

### Changed
- **codemap**: Add a parent view so the project directory can be selected by name (via `..`)

## [0.2.0] - 2026-01-21

### Added
- **codemap**: Added codemap extension

## [0.1.0] - 2026-01-21

### Added
- **skill-picker**: Hard fork of [pi-skill-palette](https://github.com/nicobailon/pi-skill-palette) (MIT), adapted for pi-extensions.
- **skill-picker**: Queues multiple skills and injects them together on the next message.
- **skill-picker**: Spacebar quick toggle for add/remove without closing the palette.
- **skill-picker**: Clear-queued confirmation when pressing Esc with queued skills.
- **skill-picker**: Loads skills from Codex/Claude/Pi directories (recursive + Claude one-level format).

### Changed
- **skill-picker**: Enter adds the selected skill (if missing) and closes the palette.
- **skill-picker**: Footer hints now reflect add/remove/toggle behavior and clear on Esc.
- **skill-picker**: Scroll indicator simplified to a left-aligned count.

### Removed
- **skill-picker**: Confirmation dialog countdown timer and progress dots.

## [0.0.1] - 2026-01-10

### Added

- Initial release
- **toolwatch**: Tool call auditing and approval system
  - Extension with sync/async modes, configurable tools, HTTP/file/fallback modes
  - Collector with SQLite storage, rules engine, plugin system
  - Rules: JSON-based matching (AND fields, OR arrays, regex patterns)
  - Manual approval plugin with DB-backed pending queue
  - Web UI with history, filters, pagination, real-time WebSocket notifications
  - Drain CLI for replaying fallback JSONL to collector
  - Test suite for rules engine, database, and lib functions
