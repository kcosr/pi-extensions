# session-followup-rules: Design Draft

## Goals

1. Generalize end-of-run nudges beyond one specific tool/workflow.
2. Keep loop prevention semantics (`stopped until next real user input`).
3. Support multiple independent rules per session.
4. Expose both command-based and interactive TUI-based configuration.
5. Preserve a clean path for AVA compatibility.

## Non-goals (v1)

- Full DSL evaluator for arbitrary logic expressions.
- Persistent cross-machine state sync.
- Dynamic hot-reload of config without `/reload`.

## Core concept

A **rule** is evaluated at `agent_end`.

If a rule is active and conditions indicate a follow-up is needed, the extension
queues a follow-up message (usually via `pi.sendUserMessage(..., { deliverAs: "followUp" })`).

Each rule has:

- Static config (matching + behavior)
- Runtime mode (`off|auto|on`)
- Runtime state (`stoppedUntilUserInput`)

## Rule schema (proposed)

```json
{
  "id": "ava-end-prompt",
  "label": "AVA end prompt",
  "enabledByDefault": true,
  "defaultMode": "auto",
  "doneTool": {
    "name": "session_rule_done",
    "requiresRuleId": true
  },
  "followUp": {
    "message": "Before you finish, prompt the user with agent-voice-adapter-cli.js in interactive mode.",
    "deliverAs": "followUp"
  },
  "limits": {
    "maxRemindersPerUserCycle": 1
  },
  "autoCondition": {
    "strategy": "last-successful-tool-matches",
    "toolMatch": {
      "toolName": "bash",
      "command": {
        "includesAny": ["agent-voice-adapter-cli", "agent-voice-adapter-cli.js"],
        "excludesAny": ["--no-wait"]
      }
    }
  }
}
```

## Runtime model

Per rule runtime state:

```ts
{
  mode: "off" | "auto" | "on";
  stoppedUntilUserInput: boolean;
  reminderCountInUserCycle: number;
  maxRemindersPerUserCycle: number;
  lastSuccessfulToolMatched: boolean;
  matchedInLastTurn: boolean;
  matchedInRun: boolean;
}
```

Global state:

- map of pending matched toolCallIds (for result correlation)
- per-rule state map keyed by rule id

## Event processing

### `input`

If `event.source !== "extension"`:

- clear `stoppedUntilUserInput` for all rules
- reset `reminderCountInUserCycle` for all rules
- clear per-run/per-turn match accumulators for next cycle

### `agent_start`

- reset per-run/per-turn match accumulators

### `tool_call`

- evaluate call-level match candidates
- cache `{ toolCallId -> matchingRuleIds }`

### `tool_execution_end`

- for successful executions, update rule runtime match state
- track last successful tool and whether it matched each rule

### `turn_end` (optional for v1)

- update `matchedInLastTurn`

### `agent_end`

For each rule:

1. `off` => skip
2. `stoppedUntilUserInput` => skip
3. `reminderCountInUserCycle >= maxRemindersPerUserCycle` => skip
4. `on` => queue follow-up
5. `auto` => queue follow-up only if rule's auto condition fails

After queuing for a rule:

- increment `reminderCountInUserCycle`

## Commands (proposed)

- `/rule-mode <rule-id> off|auto|on`
- `/rule-status [rule-id]`
- `/rule-stop <rule-id>` (sets stopped until next user input)
- `/rule-set default-mode <rule-id> <off|auto|on>`
- `/rule-set max-reminders <rule-id> <n>`
- `/rule-config` (open interactive TUI editor for current session)

Compatibility aliases can be added later:

- `/ava-mode` -> `/rule-mode ava-end-prompt ...`
- `/ava-status` -> filtered `/rule-status ava-end-prompt`

## Tool API (proposed)

### Generic done tool

`session_rule_done`

Parameters:

```json
{
  "rule_id": "string"
}
```

Effect:

- sets `stoppedUntilUserInput = true` for that rule

Optional per-rule no-arg aliases can be generated, but generic `rule_id` scales better.

## Config files

Proposed lookup:

1. `.pi/extensions/session-followup-rules/config.json` (project)
2. `~/.pi/agent/extensions/session-followup-rules/config.json` (global fallback)

If both exist, project config overrides/extends global by `rule.id`.

## Interactive TUI direction

Use `ctx.ui.custom()` to provide a lightweight rule list/settings UI:

- left pane: rules
- right pane: mode + stopped state + preview of follow-up message + match strategy
- quick actions: toggle mode, mark stopped, reset state

Start with command-only configuration first; add TUI once core engine is stable.

## Migration path from AVA extension

1. Keep `agent-voice-adapter-reminder` unchanged now.
2. Implement `session-followup-rules` with one default AVA rule.
3. Verify equivalent behavior.
4. Optionally deprecate AVA-specific extension later or keep it as thin preset wrapper.
