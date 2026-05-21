# External Tool Packs And MCP Plan

Status: planned architecture for third-party agent tools, starting with Notion MCP.

This plan is subordinate to [roadmap.md](./roadmap.md), [agent-harness-plan.md](./agent-harness-plan.md), [web-chat-plan.md](./web-chat-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md). It defines how Strata should expose external third-party tools to the shared agent loop without mixing integration-specific code into the core harness.

## Objective

Let Strata use third-party tools such as hosted MCP servers while preserving the current harness invariants:

- The agent loop remains tool-protocol agnostic.
- Core built-in tools remain owned by `@strata/tools`.
- Third-party dependencies, auth flows, remote transports, and provider quirks live in clearly named integration packages.
- External tools are visible, auditable, profile-gated, trace-backed Strata tools.

The first implementation target is Notion MCP as agent-accessible tools. Generic MCP server support can follow after the Notion path proves the package boundary, auth storage, tool naming, and execution semantics.

## Non-Goals

- Do not make MCP the ingestion source of truth yet. Raw source ingestion should continue through deterministic connector pulls unless MCP can produce stable source IDs, durable content, retries, and traceable raw artifacts equivalent to direct APIs.
- Do not put MCP client logic in `packages/agent` or the agent loop.
- Do not make arbitrary third-party MCP servers available by default.
- Do not store tokens, OAuth codes, private URLs, or other secrets in traces, wiki pages, memory, skills, proposals, or browser-rendered data.
- Do not add a plugin marketplace or dynamic untrusted package execution in this phase.

## Architectural Principle

External integrations should register ordinary Strata tools.

The agent runtime already speaks one tool abstraction:

```ts
ToolRegistry.register(tool: ToolDefinition): ToolRegistry
```

MCP and other third-party protocols should be adapters that discover or define external capabilities, translate them into `ToolDefinition`s, and execute calls through the same `ToolRegistry.safeExecuteText()` path used by first-party tools.

In short:

```text
external service / MCP server
  -> integration package adapter
  -> ToolRegistry.register(...)
  -> runAgentLoopEvents()
  -> model-facing tool call
```

## Package Boundaries

Keep integration code outside the core harness packages.

Target layout:

```text
packages/
  tools/                         # core registry, built-in local tools, shared tool-pack interfaces
  agent/                         # model/tool loop; no MCP-specific imports
  integrations/
    notion-mcp/                  # Notion hosted MCP auth/client/tool pack
    mcp/                         # later generic MCP bridge for configured servers
```

If workspace tooling prefers flat package names, use:

```text
packages/integration-notion-mcp/
packages/integration-mcp/
```

The important boundary is dependency direction:

- `@strata/agent` depends on `@strata/tools`, not on integration packages.
- Integration packages depend on `@strata/tools` and any external SDKs they need.
- CLI, TUI, and web-api composition code may opt into integration packages when building a registry.

## Shared Tool Pack Contract

Add a small tool-pack abstraction to `@strata/tools`:

```ts
export interface ToolPackContext {
  repoRoot: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export interface ToolPack {
  name: string;
  register(registry: ToolRegistry, context: ToolPackContext): Promise<void>;
}
```

Add a composition helper, but keep it explicit:

```ts
export async function createToolRegistryWithPacks(options: {
  profile?: ToolProfile;
  packs?: ToolPack[];
  context: ToolPackContext;
}): Promise<ToolRegistry> {
  const registry = createDefaultToolRegistry({ profile: options.profile });
  for (const pack of options.packs ?? []) {
    await pack.register(registry, options.context);
  }
  return registry;
}
```

This preserves the existing synchronous `createDefaultToolRegistry()` for tests and simple callers while giving CLI/TUI/web callers an explicit async path for optional third-party tool discovery.

## Notion MCP Tool Pack

Create a Notion-specific integration package first.

Responsibilities:

- Own Notion hosted MCP client construction.
- Own Notion MCP OAuth token loading/refreshing and local secret path conventions.
- List remote Notion MCP tools with names, descriptions, and input schemas.
- Register safe Strata `ToolDefinition`s for selected Notion MCP tools.
- Call remote MCP tools and normalize results into Strata `JsonValue` tool results.
- Keep Notion MCP tools disabled when auth is missing, expired, or invalid.

Initial package exports:

```ts
export interface NotionMcpToolPackOptions {
  enabled?: boolean;
  serverUrl?: string;
  allowWriteTools?: boolean;
}

export function createNotionMcpToolPack(options?: NotionMcpToolPackOptions): ToolPack;

export async function getNotionMcpStatus(context: ToolPackContext): Promise<NotionMcpStatus>;
export async function startNotionMcpAuth(...): Promise<NotionMcpStartResult>;
export async function finishNotionMcpAuth(...): Promise<NotionMcpCallbackResult>;
export async function listNotionMcpRemoteTools(...): Promise<NotionMcpRemoteTool[]>;
```

The existing implementation in `packages/web-api/src/notionMcp.ts` should be refactored so reusable auth/client/tool-listing code moves to the integration package, while web-api keeps only HTTP/tRPC route wiring and browser DTO shaping.

## Tool Naming

Use clear prefixes so external tools are obviously not first-party deterministic Strata tools.

For Notion MCP:

```text
mcp.notion.<safeToolName>
```

For generic MCP later:

```text
mcp.<serverSlug>.<safeToolName>
```

Keep a private mapping from Strata tool name to remote MCP tool name. Do not assume MCP tool names already satisfy Strata's dotted-name convention or provider tool-name limits.

Name sanitizer requirements:

- Output must pass `ToolRegistry` dotted-name validation.
- Output should be stable across runs for the same remote tool.
- Collisions must fail closed or get deterministic suffixes.
- Trace events should include both the Strata tool name and, when safe, a non-secret remote tool identifier.

## Tool Modes And Profiles

External tools should be conservative by default.

Initial rules:

- Register Notion search/read/fetch tools as `mode: "read"`.
- Do not register Notion create/update/delete/comment tools unless `allowWriteTools` is explicitly enabled.
- If write tools are enabled, mark them `mode: "write"` so read-only profiles exclude them.
- Never register remote tools as `dangerous` unless the integration package documents why and the caller explicitly opts in.

Later, generic MCP config should support per-server and per-tool allowlists:

```json
{
  "servers": {
    "notion": {
      "enabled": true,
      "tools": {
        "search": "read",
        "fetch": "read",
        "create_page": false
      }
    }
  }
}
```

## Configuration And Secrets

Separate non-secret configuration from secrets:

```text
.strata/
  integrations/
    notion-mcp.json          # non-secret local config, enabled flags, allowlists
    mcp-servers.json         # later generic MCP server declarations
  secrets/
    notion-mcp.json          # OAuth client info, refresh/access tokens
```

Rules:

- Secret files stay gitignored and server-side only.
- Browser APIs may expose auth status, server display name, and available tool summaries, but never tokens or OAuth codes.
- Error messages returned to browser or traces must be redacted.
- `.env` may override server URLs for local testing, but secrets should still be stored through the secret path or dotenvx-encrypted env values.

## Result Normalization

MCP tool results should be normalized to Strata `JsonValue` while preserving enough structure for the model and UI.

Recommended shape:

```json
{
  "content": [
    { "type": "text", "text": "..." }
  ],
  "structuredContent": {},
  "isError": false
}
```

Rules:

- Preserve text content as text, not stringified nested JSON when possible.
- Include structured content when MCP returns it and it is JSON-serializable.
- Mark remote MCP errors as failed `ToolExecutionResult`s when they are transport/auth/protocol failures.
- Mark model-visible remote tool failures as successful tool results with `isError: true` only when the remote MCP server intentionally returned an error payload.
- Respect each Strata tool's `maxResultChars` to prevent huge Notion pages from flooding context.

## Agent Runtime Integration

Do not change the core agent loop semantics.

Required changes:

1. Add async tool-registry composition for optional packs.
2. Update CLI query/TUI/web chat call sites to pass a prebuilt registry through `AgentRunConfig.tools` when external packs are enabled.
3. Keep `runAgentLoopEvents()` executing all tools via `ToolRegistry.safeExecuteText()`.
4. Record normal `tool.call`, `tool.result`, and `file.changed` events as today.

The agent loop should not import `@modelcontextprotocol/sdk`, Notion code, or generic MCP code.

## Web Control Plane Integration

The web control plane should consume the Notion MCP integration package for OAuth and status, rather than owning reusable MCP client logic.

Initial UI behavior:

- Show Notion MCP auth status.
- Start/finish OAuth through the local web API.
- List remote Notion MCP tools for verification.
- Show whether Notion MCP agent tools are enabled for chat/query runs.
- Let the user keep deterministic Notion API ingestion separate from MCP agent tools.

## Testing And Validation

Unit tests:

- Tool-pack composition registers built-ins plus pack tools.
- Notion MCP tool-name sanitization is stable and collision-safe.
- Missing/invalid Notion MCP auth does not crash default registry creation.
- Read/write mode classification respects profile filtering.
- MCP result normalization handles text, structured content, and remote errors.

Integration tests with fakes:

- Fake MCP client lists tools and receives expected `callTool` names/arguments.
- Web chat/CLI can run with a fake tool pack and execute an external tool through the normal trace path.
- Browser API never returns tokens from Notion MCP status endpoints.

Manual validation:

- Connect a real Notion MCP account through the web control plane.
- Confirm remote tool listing works.
- Run a web-chat prompt that uses `mcp.notion.*` read tools.
- Inspect `.strata/state.sqlite` and `.strata/traces/<session>.jsonl` to confirm calls are trace-backed and secrets are absent.

## Implementation Sequence

1. Add `ToolPack` and async registry composition to `@strata/tools`.
2. Create the Notion MCP integration package and move reusable code from `packages/web-api/src/notionMcp.ts` into it.
3. Preserve existing web Notion MCP OAuth/status/list-tools behavior by making web-api call the integration package.
4. Add Notion MCP remote tool schema listing and result normalization.
5. Register selected Notion MCP read tools as `mcp.notion.*` Strata tools.
6. Wire CLI query and web chat registry construction to optionally include the Notion MCP tool pack.
7. Add UI/status affordances showing that Notion MCP agent tools are available.
8. After the Notion path is stable, generalize `packages/integrations/mcp` for configured third-party MCP servers.

## Acceptance Criteria

- A fresh Strata run without Notion MCP auth behaves exactly as it does today.
- With Notion MCP connected and enabled, the model sees selected `mcp.notion.*` tools in normal tool metadata.
- Notion MCP calls execute through `ToolRegistry.safeExecuteText()` and are persisted as normal tool events.
- No MCP SDK imports appear in `packages/agent`.
- Notion MCP secrets remain under `.strata/secrets/` and never appear in wiki, memory, skills, proposals, traces, or browser-rendered payloads.
- Deterministic Notion raw snapshot ingestion remains available and separate from MCP agent querying.
