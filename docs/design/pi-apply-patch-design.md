# Apply Patch Tool + Prompt Steering (pi-mono)

## Overview
- Add an `apply_patch` tool that mirrors Codex’s patch format and behavior for safe, single‑file (or multi‑file) edits.
- Provide system‑prompt steering that encourages `apply_patch` usage and documents the patch format.

## Motivation
- Parity with Codex tooling and guidance improves model behavior consistency across projects.
- Patch‑style edits are safer and more auditable than free‑form edits for complex changes.
- Prompt steering can be enabled per project without needing full core changes.

## Proposed Solution
### Apply_patch tool (Codex‑style)
- Implement a tool named `apply_patch` that accepts a single `patchText` parameter.
- Support the Codex envelope format:
  - `*** Begin Patch` / `*** End Patch`
  - `*** Add File:` / `*** Delete File:` / `*** Update File:` with optional `*** Move to:`
  - `@@` hunks with `+`, `-`, and space‑prefixed lines
- Validate paths to stay within the session `cwd` (reject absolute paths and path traversal).
- Apply file operations with safe defaults (create parent directories for adds/moves; keep trailing newline).
- Return a summary and unified diffs in tool output (plain text), plus per‑file diff metadata for UI rendering.

### Prompt steering (appendable)
- Add Codex‑style guidance text that:
  - Encourages `apply_patch` for single‑file edits.
  - Discourages `apply_patch` for generated output or bulk scripted changes.
  - Documents the patch grammar and example usage.
- Use `APPEND_SYSTEM.md` or `--append-system-prompt` to inject this guidance without core changes.
- Optionally allow extensions to inject prompt text via `before_agent_start` for per‑model gating.

## Files to Update
**Extension‑only approach (no core changes)**
- `/tmp/pi-extensions/apply-patch-extension.ts` (new): registers `apply_patch` tool.
- Project or user prompt append file:
  - `<repo>/.pi/APPEND_SYSTEM.md` or `~/.pi/agent/APPEND_SYSTEM.md`

**Core approach (built‑in tool)**
- `packages/coding-agent/src/core/tools/apply-patch.ts` (new tool implementation)
- `packages/coding-agent/src/core/tools/index.ts` (export + include in `allTools`)
- `packages/coding-agent/src/core/system-prompt.ts` (tool description + guidance)
- `packages/coding-agent/docs/extensions.md` or `docs/sdk.md` (document tool + format)
- Add tests under `packages/coding-agent/test` for patch parsing and application

## Implementation Steps
1. Implement patch parser + file operations with Codex‑style grammar.
2. Register the tool (extension or core) and expose it in active tools.
3. Add prompt steering via `APPEND_SYSTEM.md` (or core prompt text).
4. Add tests for add/update/delete/move and error cases.

## Open Questions
- None.

## Alternatives Considered
- **Stay with edit/write only:** Simpler, but loses Codex parity and patch safety.
- **Extension tool only:** Fastest path; lacks automatic inclusion in system prompt tool list.
- **Core tool:** Best UX and prompt integration, but requires core changes + tests.

## Out of Scope
- LSP diagnostics or IDE‑level validation after patch application.
- Model‑specific tool gating baked into core (can be handled via extension rules).
