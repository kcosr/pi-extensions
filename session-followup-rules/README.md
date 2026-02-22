# session-followup-rules

Design-stage extension for generalized end-of-run follow-up behavior in pi.

## Status

This directory currently contains design notes and an implementation plan only.
No extension code is wired yet.

## Why this exists

`agent-voice-adapter-reminder` solved one workflow (voice handoff), but the core
pattern is reusable:

- Observe runtime events (`input`, `tool_call`, `tool_execution_end`, `agent_end`)
- Track per-session rule state (`off|auto|on`, stopped-until-user-input)
- At `agent_end`, conditionally enqueue a follow-up user message

`session-followup-rules` will generalize that behavior into configurable rules.

## Design docs

- [DESIGN.md](./DESIGN.md)
- [PLAN.md](./PLAN.md)
