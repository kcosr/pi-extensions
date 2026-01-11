# Changelog

## [Unreleased]

### Breaking Changes

### Added

### Changed

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
