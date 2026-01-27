# Local Rules Design

This document describes the design for supporting local rules evaluation in the toolwatch extension, separating rules evaluation from audit logging.

## Motivation

Currently, toolwatch only supports remote rules evaluation via the collector. This requires:
- Running the collector server
- Network connectivity between extension and collector
- Database storage for audit logs

For simpler use cases, users may want:
- Local rules evaluation without a collector (pure gate)
- Local rules with local file audit (no network)
- Local manual approval via TUI (no web UI)

## Design Goals

1. **Separate concerns**: Rules evaluation and audit logging are independent
2. **Local-first**: Support local rules without any external dependencies
3. **TUI integration**: Local manual approval via pi's confirm dialog
4. **Backward compatible**: Existing remote mode continues to work

## Configuration

### Structure

```typescript
interface Config {
  rules: {
    mode: "local" | "remote" | "none";
    // local mode only
    rules?: Rule[];
    plugins?: Record<string, string>;
    // remote mode only (requires audit.http.url)
    timeoutMs?: number;          // 0 or undefined = no timeout
    errorAction?: "block" | "allow";   // Action on timeout or HTTP error
  };

  audit: {
    mode: "none" | "file" | "http" | "both" | "http-with-fallback";
    http?: { url: string };
    file?: { path: string };
  };

  tools: string[];
}
```

### Rules Mode

| Mode | Description |
|------|-------------|
| `local` | Evaluate rules locally in the extension |
| `remote` | Send events to collector for rules evaluation (requires `audit.http.url`) |
| `none` | No rules evaluation (audit only or passthrough) |

### Audit Mode

| Mode | Description |
|------|-------------|
| `none` | No audit logging |
| `file` | Write events to local JSONL file |
| `http` | Send events to collector via HTTP |
| `both` | Write to file AND send via HTTP |
| `http-with-fallback` | Send via HTTP, write to file on failure |

**Audit-only HTTP events**: When the extension is only logging (local rules or `rules.mode: "none"`), it marks HTTP audit requests with `X-Toolwatch-Audit: true` so the collector stores the event without evaluating rules and returns `{ "approved": true }`.

### Example Configurations

**Local rules only, no audit (simple gate):**
```json
{
  "rules": {
    "mode": "local",
    "rules": [
      { "match": { "tool": "bash", "params.command": "/rm -rf/" }, "action": "deny", "reason": "Dangerous command" },
      { "action": "allow" }
    ]
  },
  "audit": { "mode": "none" },
  "tools": []
}
```

**Local rules with TUI manual approval:**
```json
{
  "rules": {
    "mode": "local",
    "rules": [
      { "match": { "params.path": "/\\.env/" }, "action": "manual" },
      { "action": "allow" }
    ]
  },
  "audit": { "mode": "file", "file": { "path": "/tmp/toolwatch.jsonl" } },
  "tools": []
}
```

**Remote rules, wait forever (manual approval via web UI):**
```json
{
  "rules": { "mode": "remote" },
  "audit": { "mode": "http", "http": { "url": "http://localhost:9999/events" } },
  "tools": ["bash", "read"]
}
```

**Remote rules with 30s timeout, deny on timeout:**
```json
{
  "rules": { "mode": "remote", "timeoutMs": 30000, "errorAction": "block" },
  "audit": { "mode": "http", "http": { "url": "http://localhost:9999/events" } },
  "tools": ["bash", "read"]
}
```

**No rules (audit only):**
```json
{
  "rules": { "mode": "none" },
  "audit": { "mode": "http", "http": { "url": "http://localhost:9999/events" } },
  "tools": ["bash", "read", "write", "edit"]
}
```

**Local rules with remote audit:**
```json
{
  "rules": {
    "mode": "local",
    "rules": [
      { "match": { "tool": "bash", "params.command": "/sudo/" }, "action": "deny" },
      { "action": "allow" }
    ]
  },
  "audit": { "mode": "http", "http": { "url": "http://localhost:9999/events" } },
  "tools": []
}
```

## Module Structure

```
toolwatch/
├── common/                      # Shared module (no external dependencies)
│   ├── package.json
│   ├── src/
│   │   ├── index.ts            # Public exports
│   │   ├── types.ts            # Shared types (events, rules, config)
│   │   ├── rules.ts            # Rules evaluation engine
│   │   └── plugin-loader.ts    # Generic plugin loading
│   └── tsconfig.json
├── collector/                   # Imports common, adds DB/server
│   ├── src/
│   │   ├── db.ts               # SQLite database
│   │   ├── server.ts           # HTTP server
│   │   ├── config.ts           # Collector config (rules file path)
│   │   └── ...
│   └── plugins/
│       └── manual.ts           # DB-based manual approval (web UI)
├── extension/                   # Imports common, pi extension
│   ├── src/
│   │   ├── index.ts            # Main extension entry
│   │   ├── config.ts           # Extension config loading
│   │   ├── evaluator.ts        # Local + remote evaluation
│   │   └── audit.ts            # Audit logging (file/http)
│   └── plugins/
│       └── manual.ts           # TUI-based manual approval
└── docs/
    └── design/
        └── local-rules.md      # This document
```

## Plugin Interface

Plugins provide custom approval logic beyond simple allow/deny rules.

```typescript
interface ApprovalPlugin {
  evaluate(event: ToolCallEvent, ctx?: unknown): Promise<ApprovalResponse>;
}

interface ApprovalResponse {
  approved: boolean;
  reason?: string;
}
```

### Plugin Context

- **Local plugins**: Receive `ExtensionContext` from pi, enabling TUI interactions
- **Remote plugins**: Receive `ToolwatchDB` reference for database access

### Manual Approval

Use `"action": "manual"` for interactive approval:

- **Local mode (extension)**: Shows TUI confirmation dialog via `ctx.ui.confirm()`
- **Remote mode (collector)**: Stores pending approval, waits for web UI action

## Rules Evaluation

### Rule Structure

```typescript
interface Rule {
  comment?: string;           // Human-readable description
  match?: MatchCondition;     // Condition to match (empty = match all)
  action: "allow" | "deny" | "manual" | "plugin";
  plugin?: string;            // Plugin name (required if action = "plugin")
  reason?: string;            // Reason returned on deny
}

type MatchValue = string | string[];  // Single pattern or OR array
type MatchCondition = Record<string, MatchValue>;  // AND across fields
```

### Pattern Matching

- **Exact match**: `"bash"` matches `"bash"`
- **Regex match**: `"/rm\\s+-rf/"` matches regex pattern
- **Array (OR)**: `["bash", "read"]` matches either

### Field Paths

Dot notation for nested fields:
- `tool` - tool name
- `user` - username
- `params.command` - bash command
- `params.path` - file path

### Evaluation Order

1. Rules evaluated in order (first match wins)
2. No match = default allow
3. `action: "plugin"` invokes named plugin

## Data Flow

### Local Mode

```
Tool Call → Extension
    ↓
Evaluate Local Rules
    ↓
[If plugin] → Load Plugin → Plugin.evaluate(event, ctx)
    ↓
Return ApprovalResponse
    ↓
[If audit enabled] → Write to file / Send HTTP (async)
```

HTTP audit requests include `X-Toolwatch-Audit: true` so the collector treats them as log-only and returns `approved` without rule evaluation.

### Remote Mode

```
Tool Call → Extension
    ↓
Send HTTP to Collector (sync)
    ↓
[Collector] Evaluate Rules → [If plugin] → Plugin.evaluate(event, db)
    ↓
Return ApprovalResponse
    ↓
[Collector] Store in DB
```

### Audit Only Mode (rules: none)

```
Tool Call → Extension
    ↓
Allow (no evaluation)
    ↓
[If audit enabled] → Write to file / Send HTTP (async)
```

When HTTP audit is enabled, the collector records the event as approved without applying rules.

## Migration

Existing configs (current format) will continue to work. The extension detects the format and handles both:

**Legacy format:**
```json
{
  "mode": "http-with-fallback",
  "http": { "url": "...", "sync": true, "timeoutMs": 30000, "errorAction": "block" },
  "file": { "path": "/tmp/toolwatch.jsonl" },
  "tools": ["bash"]
}
```

**New format:**
```json
{
  "rules": { "mode": "remote", "timeoutMs": 30000, "errorAction": "block" },
  "audit": { "mode": "http", "http": { "url": "..." } },
  "tools": ["bash"]
}
```

The extension checks for `rules` key to determine format version.

## Future Considerations

- **Rule inheritance**: Include rules from external files
- **Rule caching**: Cache compiled regex patterns
- **Plugin discovery**: Auto-discover plugins from directories
- **Metrics**: Track rule evaluation stats locally
