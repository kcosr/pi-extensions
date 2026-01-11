# toolwatch

Tool call auditing and approval system.

- **Audit logging** - All tool calls recorded with user, timestamp, model, and parameters
- **Configurable rules** - JSON-based rules to allow, deny, or require approval
- **Plugin system** - TypeScript plugins for custom approval logic
- **Manual approval** - Web UI for reviewing and approving/denying tool calls
- **Sync/async modes** - Block on approval or fire-and-forget logging

## Components

| Component | Description |
|-----------|-------------|
| [extension/](extension/) | Pi extension that captures tool calls |
| [collector/](collector/) | HTTP server with SQLite storage and web UI |

## Install

### 1. Start the Collector

```bash
cd ~/pi-extensions/toolwatch/collector
npm install
npm run dev
```

Runs at http://localhost:9999 by default.

### 2. Install the Extension

Symlink or copy:

```bash
ln -s ~/pi-extensions/toolwatch/extension ~/.pi/agent/extensions/toolwatch
```

Or add to `~/.pi/agent/settings.json`:

```json
{
  "extensions": ["~/pi-extensions/toolwatch/extension"]
}
```

### 3. Configure

Edit `extension/config.json`:

```json
{
  "mode": "http-with-fallback",
  "http": {
    "url": "http://localhost:9999/events",
    "sync": true,
    "timeoutMs": 30000,
    "timeoutAction": "block"
  },
  "file": { "path": "/tmp/toolwatch.jsonl" },
  "tools": ["bash", "read", "grep"]
}
```

Edit `collector/config.json`:

```json
{
  "rules": [
    { 
      "match": { "tool": "bash", "params.command": ["/rm\\s+-rf/", "/sudo/"] }, 
      "action": "deny",
      "reason": "Dangerous command blocked"
    },
    { "action": "allow" }
  ],
  "plugins": {}
}
```

### 4. Reload pi

---

## Extension Configuration

### Modes

| Mode | Description |
|------|-------------|
| `http` | Send to HTTP only, drop on failure |
| `file` | Write to JSONL file only |
| `both` | Always write to both |
| `http-with-fallback` | Try HTTP, write to file on failure |

### HTTP Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `url` | string | `http://localhost:9999/events` | Collector endpoint |
| `sync` | boolean | `false` | Wait for approval response |
| `timeoutMs` | number | `30000` | Sync mode timeout |
| `timeoutAction` | `"block"` \| `"allow"` | `"block"` | Action on timeout |

### Tools

Array of tool names to audit. Empty array = all tools.

Default: `["bash", "read", "grep"]`

---

## Collector Configuration

### Rules

Rules are evaluated top-to-bottom, first match wins.

#### Match Syntax

- **Exact match**: `"tool": "bash"`
- **Regex**: `"params.command": "/rm.*-rf/"` (wrapped in `/`)
- **OR (array)**: `"tool": ["bash", "read"]`
- **AND (multiple fields)**: `{ "tool": "bash", "user": "admin" }`

#### Matchable Fields

`tool`, `user`, `hostname`, `cwd`, `model`, `params.command`, `params.path`, etc.

#### Actions

| Action | Description |
|--------|-------------|
| `allow` | Approve immediately |
| `deny` | Deny with optional `reason` |
| `plugin` | Invoke named plugin |

---

## Web UI

Single page at `/` with:
- Tool call history with filters, paginated (50 per page)
- Real-time pending approval notifications via WebSocket
- Navigation between multiple pending approvals (< 1 of N >)
- Connection status indicator (connected/disconnected)

---

## Recipes

### Audit Only (No Blocking)

```json
// extension/config.json
{ "mode": "http-with-fallback", "http": { "sync": false }, "tools": [] }

// collector/config.json
{ "rules": [{ "action": "allow" }], "plugins": {} }
```

### Block Dangerous Commands

```json
// collector/config.json
{
  "rules": [
    { 
      "match": { "tool": "bash", "params.command": ["/rm\\s+-rf/", "/sudo/"] }, 
      "action": "deny",
      "reason": "Dangerous command blocked"
    },
    { "action": "allow" }
  ]
}
```

### Manual Approval for Sensitive Files

```json
// collector/config.json
{
  "rules": [
    { 
      "match": { "params.path": "/\\.(env|pem|key)$/" }, 
      "action": "plugin", 
      "plugin": "manual" 
    },
    { "action": "allow" }
  ],
  "plugins": { "manual": "./plugins/manual.ts" }
}
```

---

## Custom Plugins

```typescript
// plugins/my-plugin.ts
import type { ToolCallEvent, ApprovalPlugin } from "../src/types.js";

const plugin: ApprovalPlugin = {
  async evaluate(event: ToolCallEvent) {
    // event: { toolCallId, ts, user, hostname, cwd, model, tool, params }
    return { 
      approved: true,  // or false
      reason: "..."    // shown to agent if denied
    };
  },
};

export default plugin;
```

Register in `collector/config.json`:

```json
{
  "plugins": { "my-plugin": "./plugins/my-plugin.ts" }
}
```

See [collector/plugins/](collector/plugins/) for examples.

---

## API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/events` | POST | Receive tool call/result events |
| `/api/calls` | GET | Query tool calls |
| `/api/stats` | GET | Statistics |
| `/api/pending` | GET | Pending approvals |
| `/approve/:id` | POST | Approve pending |
| `/deny/:id` | POST | Deny pending |

---

## Database Tool

CLI for exporting and deleting records:

```bash
cd collector

# Export to JSON
node scripts/db-tool.mjs ./toolwatch.db export --output backup.json
node scripts/db-tool.mjs ./toolwatch.db export --user alice --tool bash
node scripts/db-tool.mjs ./toolwatch.db export --before 2026-01-01 --limit 100

# Delete records (requires at least one filter)
node scripts/db-tool.mjs ./toolwatch.db delete --approval pending --dry-run
node scripts/db-tool.mjs ./toolwatch.db delete --before 2026-01-01
```

Options: `--user`, `--tool`, `--model`, `--approval`, `--error`, `--success`, `--before`, `--after`, `--search`, `--limit`, `--output`, `--dry-run`

---

## Container Deployment

Run collector on host, mount extension read-only:

```bash
docker run \
  -v ~/pi-extensions/toolwatch/extension:/home/user/.pi/agent/extensions/toolwatch:ro \
  --network host \
  ...
```

---

## Testing

```bash
cd collector
npm test          # Run tests once
npm run test:watch  # Watch mode
```

## Files

```
toolwatch/
├── extension/
│   ├── config.json
│   ├── index.ts
│   ├── lib.ts
│   └── drain.ts
└── collector/
    ├── config.json
    ├── src/
    │   ├── index.ts
    │   ├── server.ts
    │   ├── db.ts
    │   ├── rules.ts
    │   └── ui.ts
    ├── plugins/
    │   └── manual.ts
    ├── scripts/
    │   └── db-tool.mjs
    └── test/
        ├── rules.test.ts
        ├── db.test.ts
        └── lib.test.ts
```

## Known Limitations

**Sync mode blocking**: When `sync: true`, the extension blocks waiting for approval. During this time, the user cannot cancel with Escape in pi. This is because pi's `tool_call` event handlers don't receive an AbortSignal. Workarounds:
- Use shorter `timeoutMs` values
- Set `timeoutAction: "allow"` to proceed on timeout
- Use `sync: false` for audit-only mode

## Todo

- [ ] Cursor-based pagination for high-write scenarios
