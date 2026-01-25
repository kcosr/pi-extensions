# CLI Provider for Pi

## Overview

This design document describes integrating external CLI tools (like Claude CLI, Codex CLI) as a new Provider type in pi. The goal is to create an abstraction layer that takes streaming JSON output from external CLIs and converts it into pi's native `AssistantMessageEvent` format.

## Background

### Assistant App's CLI Integration

The assistant app (`packages/agent-server`) already integrates with pi CLI via `piCliChat.ts`. Key observations:

1. **Spawning**: Runs `pi --mode json -p <message>` to get JSONL streaming output
2. **Event parsing**: Parses each JSON line and extracts:
   - `message_update` events containing `assistantMessageEvent` with text/thinking deltas
   - `tool_execution_start`, `tool_execution_update`, `tool_execution_end` events
   - `session` header for session ID/cwd
3. **Callbacks**: Converts events to assistant app's internal format via callbacks (`onTextDelta`, `onToolCallStart`, etc.)

### Pi's Provider Architecture (updated)

Recent changes add a registry + custom provider support:

1. **`Api` type**: `KnownApi` is enumerated, but `Api` is open (`KnownApi | string`), so new API strings like `"external-cli"` do not require core changes.
2. **API registry**: `packages/ai/src/api-registry.ts` + `providers/register-builtins.ts` register stream implementations via `registerApiProvider()`.
3. **`stream()` / `streamSimple()`**: Dispatch through the registry (built-ins are auto-registered on import).
4. **Extension registration**: `pi.registerProvider()` (coding-agent) lets extensions register models, override baseUrl/headers, add OAuth, and provide `streamSimple` for custom APIs.
5. **Docs/Example**: `packages/coding-agent/docs/custom-provider.md` and `packages/coding-agent/examples/extensions/custom-provider`.

## Design

### Update: Custom Provider + API Registry

Given the new registry + extension API, the CLI provider can ship as an extension using `pi.registerProvider()` and `streamSimple`, rather than changing core `stream.ts`. This lets us iterate the CLI protocol out-of-tree while still integrating with pi’s model registry, OAuth, and tools.

Key implications:
- **Decision:** implement as an extension only (no core changes).
- The CLI provider can be registered dynamically (`api: "external-cli"` + `streamSimple`).
- No core switch-case update is needed; `stream()` resolves via the API registry.
- Extension-level config can map model IDs to CLI executables/args; use model/provider config only for values required by the registry (see validation notes below).

### New API Type: `external-cli`

Because `Api` is open, `"external-cli"` can be used immediately. For discoverability we can optionally add it to `KnownApi`, but the registry works with any string.

```typescript
// In an extension or built-in provider registration
pi.registerProvider("claude-cli", {
  api: "external-cli",
  streamSimple: streamExternalCli,
  baseUrl: "cli://local", // placeholder to satisfy model registry validation
  apiKey: "CLI_NO_KEY",    // placeholder (unused) to avoid core changes
  models: [/* ... */],
});
```

If implemented in core instead of an extension, register it in `packages/ai/src/providers/register-builtins.ts`.

### External CLI Configuration (extension-owned)

`streamSimple()` only receives `SimpleStreamOptions`, so CLI-specific fields should live in the extension (e.g., a lookup table keyed by model id or a config file the extension reads). Only CLI-invokable settings apply; provider-level fields like `baseUrl`/`apiKey` are placeholders. We only map the **model picker** and **thinking level toggle** into CLI flags (`--model` and `--thinking` per assistant CLI conventions); other `SimpleStreamOptions` values like maxTokens/temperature are ignored.

We can still define a local options type to document supported knobs:

```typescript
// In providers/external-cli.ts (extension or built-in)
export interface ExternalCliOptions extends SimpleStreamOptions {
  /** Path to the CLI executable (e.g., "claude", "codex", "/usr/local/bin/my-cli") */
  executable?: string;
  /** Extra CLI arguments to append (in addition to --model/--thinking) */
  extraArgs?: string[];
  /** Working directory for the CLI process */
  workdir?: string;
  /** Environment variables to set/override for the CLI process */
  env?: Record<string, string>;
  /** Timeout in milliseconds (default: none) */
  timeout?: number;
  /** Session ID for CLIs that support session persistence */
  cliSessionId?: string;
}
```

CLI args/config should not be overloaded into provider config. Keep them in extension-owned config (JSON file or map) and merge into spawn options:

```typescript
const cliConfigByModel = loadCliConfig("~/.pi/agent/extensions/cli-providers/config.json") ?? {
  "claude-cli": {
    executable: "claude",
    modelArg: "claude-sonnet-4-20250514",
    extraArgs: ["--json"],
  },
};

const cliConfig = cliConfigByModel[model.id] ?? {};
streamExternalCli(model, context, { ...options, ...cliConfig });
```

### Model Configuration

Model entries still use the standard `Model` shape for selection/metadata; only the model choice and thinking toggle are translated into CLI flags. `maxTokens`, `contextWindow`, and similar limits are informational only and are not passed to the CLI. CLI-specific config should live in extension-owned config keyed by model id.

```typescript
// Example model definition for Claude CLI
const claudeCliModel: Model<"external-cli"> = {
  id: "claude-cli",
  name: "Claude CLI",
  api: "external-cli",
  provider: "anthropic-cli",
  baseUrl: "cli://local", // placeholder; not used by CLI
  reasoning: true,
  input: ["text", "image"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },  // Cost handled by CLI
  contextWindow: 200000,
  maxTokens: 8192,
};

const cliConfigByModel = {
  "claude-cli": {
    executable: "claude",
    modelArg: "claude-sonnet-4-20250514",
    extraArgs: ["--json"],
    outputFormat: "jsonl", // or "sse" for server-sent events
  },
};
```

### Event Stream Protocol

The CLI provider expects the external CLI to output JSONL events. Two protocol flavors:

#### Protocol A: Pi-style Events (preferred)

CLIs that output pi-compatible events:

```jsonl
{"type":"session","id":"abc123","cwd":"/path/to/project"}
{"type":"message_start","message":{"role":"assistant","content":[],...}}
{"type":"message_update","message":{...},"assistantMessageEvent":{"type":"text_delta","delta":"Hello","contentIndex":0}}
{"type":"tool_execution_start","toolCallId":"call_1","toolName":"Read","args":{"path":"file.txt"}}
{"type":"tool_execution_update","toolCallId":"call_1","toolName":"Read","partialResult":{"content":[{"type":"text","text":"..."}]}}
{"type":"tool_execution_end","toolCallId":"call_1","toolName":"Read","result":{...},"isError":false}
{"type":"message_end","message":{...}}
```

#### Protocol B: Simple Events (for simpler CLIs)

Minimal protocol for CLIs without full event support:

```jsonl
{"type":"text","delta":"Hello"}
{"type":"thinking","delta":"Let me think..."}
{"type":"tool_call","id":"call_1","name":"bash","arguments":{"command":"ls"}}
{"type":"tool_result","id":"call_1","content":"file1.txt\nfile2.txt"}
{"type":"done"}
```

### Stream Implementation

Implement as a `streamSimple` handler (matches the custom-provider pattern):

```typescript
// In providers/external-cli.ts (extension or built-in)
export function streamExternalCli(
  model: Model<"external-cli">,
  context: Context,
  options?: ExternalCliOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: "external-cli",
      provider: model.provider,
      model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {...} },
      stopReason: "stop",
      timestamp: Date.now(),
    };

    try {
      const child = spawnCli(model, context, options);
      stream.push({ type: "start", partial: output });

      for await (const event of parseCliOutput(child.stdout)) {
        const converted = convertToAssistantEvent(event, output);
        if (converted) {
          stream.push(converted);
        }
      }

      const exitCode = await waitForExit(child);
      if (exitCode !== 0) {
        throw new Error(`CLI exited with code ${exitCode}`);
      }

      stream.push({ type: "done", reason: output.stopReason, message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}
```

### CLI Spawning

```typescript
function spawnCli(
  model: Model<"external-cli">,
  context: Context,
  options?: ExternalCliOptions,
): ChildProcess {
  const cliConfig = cliConfigByModel[model.id];
  const executable = options?.executable || cliConfig?.executable || model.id;
  
  // Build arguments
  const args: string[] = [];
  
  // Most CLIs use --mode json for JSONL output
  args.push("--mode", "json");
  
  // Model picker -> CLI model name (assistant CLI convention)
  const modelArg = cliConfig?.modelArg ?? model.id;
  if (modelArg) {
    args.push("--model", modelArg);
  }
  
  // Thinking level toggle -> CLI flag (assistant CLI convention)
  if (options?.reasoning) {
    args.push("--thinking", options.reasoning);
  }
  
  // Extra args from config/options
  if (cliConfig?.extraArgs) {
    args.push(...cliConfig.extraArgs);
  }
  if (options?.extraArgs) {
    args.push(...options.extraArgs);
  }
  
  // Non-interactive mode with prompt
  // The prompt is serialized context (last user message)
  const lastUserMessage = context.messages.findLast(m => m.role === "user");
  const prompt = typeof lastUserMessage?.content === "string" 
    ? lastUserMessage.content 
    : lastUserMessage?.content.map(c => c.type === "text" ? c.text : "").join("\n");
  
  args.push("-p", prompt);

  // Spawn with environment
  const env = { ...process.env, ...options?.env };
  const child = spawn(executable, args, {
    cwd: options?.workdir,
    env,
    stdio: ["pipe", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
  
  return child;
}
```

### Event Conversion

```typescript
function convertToAssistantEvent(
  cliEvent: CliEvent,
  output: AssistantMessage,
): AssistantMessageEvent | null {
  switch (cliEvent.type) {
    case "message_update": {
      // Pi-style event
      const inner = cliEvent.assistantMessageEvent;
      if (inner?.type === "text_delta") {
        updateTextContent(output, inner.contentIndex, inner.delta);
        return { type: "text_delta", contentIndex: inner.contentIndex, delta: inner.delta, partial: output };
      }
      if (inner?.type === "thinking_delta") {
        updateThinkingContent(output, inner.contentIndex, inner.delta);
        return { type: "thinking_delta", contentIndex: inner.contentIndex, delta: inner.delta, partial: output };
      }
      break;
    }
    
    case "text": {
      // Simple protocol
      const idx = ensureTextContent(output);
      (output.content[idx] as TextContent).text += cliEvent.delta;
      return { type: "text_delta", contentIndex: idx, delta: cliEvent.delta, partial: output };
    }
    
    // ... handle other event types
  }
  
  return null;
}
```

## Files to Update (post custom-provider changes)

**Option A: Built-in provider (core)**
- `packages/ai/src/providers/external-cli.ts` - New stream implementation.
- `packages/ai/src/providers/register-builtins.ts` - Register `"external-cli"` in the API registry.
- `packages/ai/src/types.ts` - Optionally add `"external-cli"` to `KnownApi` for discoverability.
- `packages/ai/src/utils/cli-output-parser.ts` - JSONL parsing utilities.

**Option B: Extension-based provider (recommended)**
- `packages/coding-agent/docs/custom-provider.md` - Reference for `pi.registerProvider()` + `streamSimple`.
- `packages/coding-agent/examples/extensions/external-cli/` (new) or a built-in extension to register the CLI provider.
- `packages/coding-agent/src/core/model-registry.ts` - Relax baseUrl/apiKey validation for `"external-cli"` (or require placeholder values in the extension).

## Configuration Example (extension)

Register the provider inside an extension (similar to the new custom-provider example):

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const cliConfigByModel = {
  "claude-cli/sonnet": { executable: "claude", modelArg: "claude-sonnet-4-20250514" },
  "codex-cli": { executable: "codex", extraArgs: ["--json"] },
};

export default function (pi: ExtensionAPI) {
  pi.registerProvider("cli", {
    api: "external-cli",
    baseUrl: "cli://local", // placeholder
    apiKey: "CLI_NO_KEY",    // unused; or relax validation for external-cli
    models: [
      {
        id: "claude-cli/sonnet",
        name: "Claude CLI (Sonnet)",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "codex-cli",
        name: "OpenAI Codex CLI",
        reasoning: true,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
    streamSimple: (model, context, options) =>
      streamExternalCli(model, context, { ...options, ...cliConfigByModel[model.id] }),
  });
}
```

Note: current model registry validation requires `baseUrl` and `apiKey` when defining models. We will use placeholders as above to avoid core changes. Token limits in model metadata are not forwarded to the CLI; the CLI owns its own limits.

## Session Ownership Model

### CLI is Authoritative (Recommended Approach)

The external CLI owns the conversation state. Pi acts as a display/UI wrapper that shadows the session for its own purposes.

```
┌─────────────────────────────────────────────────────────┐
│  Pi (Display/UI Layer)                                  │
│  ┌─────────────────────────────────────────────────────┐│
│  │ pi session file (shadow copy)                       ││
│  │ - mirrors CLI events for display                    ││
│  │ - stores pi-specific metadata (labels, branches)    ││
│  └─────────────────────────────────────────────────────┘│
│                          │                              │
│                          ▼                              │
│  ┌─────────────────────────────────────────────────────┐│
│  │ CLI Provider                                        ││
│  │ - spawns CLI with --session <id>                    ││
│  │ - streams events → pi session file                  ││
│  │ - on resume: CLI loads its own session              ││
│  └─────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│  External CLI (claude, codex, etc.)                     │
│  - owns conversation state                              │
│  - owns tools (Read, Bash, Edit, Write)                 │
│  - manages its own session files                        │
└─────────────────────────────────────────────────────────┘
```

### Key Principles

1. **CLI owns tools**: The CLI has its own tools and invokes them directly. Pi does not expose tools to the CLI - it just displays tool execution events.

2. **CLI owns context**: The CLI handles context management, compaction, and LLM communication. Pi doesn't reconstruct context for the LLM.

3. **Pi shadows for display**: Pi writes CLI events to its own session format for:
   - Displaying conversation history in the UI
   - Supporting pi-specific features (labels, search, branches)
   - Fast session list/preview without spawning CLI

4. **Resume via CLI**: On session resume, pi spawns CLI with `--session X --continue`. The CLI loads its own history and handles context.

### Session Flow

**Start new session:**
1. Pi generates session ID (e.g., `abc123`)
2. Spawns: `claude --session abc123 --mode json -p "prompt"`
3. CLI creates its session, streams JSONL events
4. Pi writes events to shadow session file

**Resume session:**
1. Pi loads shadow session file for immediate display
2. Spawns: `claude --session abc123 --continue --mode json`
3. CLI loads its session, ready for new prompts
4. New events append to pi's shadow

**Continue conversation:**
1. User types new prompt in pi
2. Spawns: `claude --session abc123 --mode json -p "new prompt"`
3. CLI continues from its session state

### Handling Direct CLI Use (Edge Case)

If user runs CLI directly outside of pi, pi's shadow copy becomes stale.

**Detection (future):** On resume, pi could request CLI's session state:
```bash
claude --session abc123 --export-history --format jsonl
```

**Reconciliation strategies:**
1. **Append-only merge**: If CLI has entries pi doesn't, append them
2. **Mark divergence**: If histories differ, show warning, offer to resync
3. **Lazy sync**: Show shadow immediately, reconcile when CLI outputs session header

**MVP approach:** No automatic merge. CLI is authoritative - if user used CLI directly, they can continue from CLI's state. Pi's shadow may be stale but still useful for search/history.

### Phase 2: Session Reconciliation (Deferred)

Future work could add:
- `--export-history` support to detect/merge divergent sessions
- Bidirectional sync when user switches between pi and direct CLI use
- Conflict resolution UI for divergent histories

## Implementation Notes

1. **Image support**: Pi stores images as base64 in memory/session files. For CLI providers:
   - Current paste flow: write temp file → insert path → on submit, read back as base64
   - CLI provider flow: write temp file → insert path → on submit, pass `@filepath` to CLI directly
   - Detection: Check `model.api === "external-cli"` at submit time in `processFileArguments` or `spawnCli`
   - The `Model` interface has `api` field accessible via `session.model?.api`

2. **Token limits**: Do not forward `maxTokens` or `temperature`; only forward model selection and thinking level via CLI flags (assistant CLI conventions). Model metadata is for UI/selection only.

3. **Tool rendering**: Convert CLI tool events into custom messages in the extension. Without pi core changes, these won't hook into the built-in tool expand/collapse toggle.

4. **Error handling**: Parse stderr for known patterns (rate limits, auth errors), surface raw error otherwise

5. **Streaming interruption**: SIGTERM with fallback to SIGKILL after timeout (match existing piCliChat.ts approach)

6. **Session ID mapping**: Use CLI session IDs directly - pi stores a reference to the CLI session ID in its shadow file header

7. **Multi-CLI sessions**: Not supported in MVP - a pi session is bound to one CLI provider for its lifetime. Switching from Claude CLI to Codex CLI mid-session would lose context (the new CLI has no history). Model switching *within* the same CLI (e.g., Sonnet → Opus) works if the CLI supports it.

## Files to Update

- `cli-providers/index.ts`
- `cli-providers/config.example.json`
- `cli-providers/README.md`
- `README.md`
- `CHANGELOG.md`

## Open Questions

- None.

**Note:** Showing CLI tool output immediately during streaming currently triggers a new turn because `sendMessage()` steers when streaming. To display tool output in real time without loops, pi core would need a “display-only” custom message path that does not enqueue steer/follow-up messages.
