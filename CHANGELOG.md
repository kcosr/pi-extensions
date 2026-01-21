# Changelog

## [Unreleased]

### Breaking Changes

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

### Fixed

### Removed


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
