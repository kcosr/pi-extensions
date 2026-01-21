# Development Guidelines

## Overview

pi-extensions is a collection of extensions for the [pi coding agent](https://github.com/badlogic/pi-mono). See the pi-mono repository for context and instructions on writing extensions.

## Extensions

| Extension | Description |
|-----------|-------------|
| [skill-picker](skill-picker/) | Command palette for selecting and queueing skills |
| [toolwatch](toolwatch/) | Tool call auditing and approval system |

## Commands

```bash
# Run toolwatch collector in development
cd toolwatch/collector && npm run dev

# Run tests
cd toolwatch/collector && npm test
```

## Code Quality

- No `any` types unless absolutely necessary
- Keep changes scoped and avoid unrelated refactors
- For any new feature or behavior change, add or update tests

## Changelog

Location: `CHANGELOG.md` (root)

### Format

Use these sections under `## [Unreleased]`:
- `### Breaking Changes` - API changes requiring migration
- `### Added` - New features
- `### Changed` - Changes to existing functionality
- `### Fixed` - Bug fixes
- `### Removed` - Removed features

### Rules

- New entries ALWAYS go under `## [Unreleased]`
- Append to existing subsections, do not create duplicates
- NEVER modify already-released version sections

## Releasing

1. Ensure working directory is clean and on `main` branch
2. Verify `## [Unreleased]` in `CHANGELOG.md` includes all changes
3. Run the release script:
   ```bash
   node scripts/release.mjs patch   # Bug fixes
   node scripts/release.mjs minor   # New features
   node scripts/release.mjs major   # Breaking changes
   ```

The script:
- Bumps VERSION file
- Updates CHANGELOG.md with release date
- Commits and tags
- Pushes to remote
- Creates GitHub release
- Adds new [Unreleased] section
