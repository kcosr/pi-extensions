# session-followup-rules: Implementation Plan

## Phase 1: Rule engine skeleton

- [ ] Create extension scaffold (`index.ts`, `package.json`, `README.md`)
- [ ] Define TypeScript types for rules and runtime state
- [ ] Implement config loading + validation with safe defaults
- [ ] Add unit tests for matcher logic and auto-condition evaluation

## Phase 2: Event wiring

- [ ] Wire `input`, `agent_start`, `tool_call`, `tool_execution_end`, `agent_end`
- [ ] Track matched tool calls by `toolCallId`
- [ ] Support `mode` + `stoppedUntilUserInput` semantics per rule
- [ ] Add per-rule reminder counters with `maxRemindersPerUserCycle`
- [ ] Reset counters on real user input (`source !== "extension"`)
- [ ] Queue follow-up with `sendUserMessage(..., { deliverAs: "followUp" })`

## Phase 3: Control surface

- [ ] Add `/rule-mode <rule-id> off|auto|on`
- [ ] Add `/rule-status [rule-id]`
- [ ] Add `/rule-stop <rule-id>`
- [ ] Add `/rule-set default-mode <rule-id> <off|auto|on>`
- [ ] Add `/rule-set max-reminders <rule-id> <n>`
- [ ] Add `session_rule_done` tool (`rule_id` required)

## Phase 4: AVA compatibility preset

- [ ] Ship a default `ava-end-prompt` rule that mirrors current AVA behavior
- [ ] Add optional compatibility aliases (`/ava-mode`, `/ava-status`)
- [ ] Document differences from `agent-voice-adapter-reminder`

## Phase 5: TUI configurator (optional)

- [ ] Add `/rule-config` with `ctx.ui.custom()`
- [ ] Rule picker + mode toggle + mark-stopped action
- [ ] Persist per-session overrides cleanly

## Open decisions

1. Should follow-up delivery mode be configurable per rule (`followUp` vs `steer`)?
2. Should rules support message-content matching in v1 or v2?
3. Should per-session overrides persist via `appendEntry` or remain in-memory only?
4. Should we expose one generic tool only, or generate per-rule no-arg tools?
