# Strata Extensions Plan

Status: planned architecture for Pi-style local extensions.

This plan is subordinate to [roadmap.md](./roadmap.md), [agent-harness-plan.md](./agent-harness-plan.md), [tui-plan.md](./tui-plan.md), [web-chat-plan.md](./web-chat-plan.md), and [tool-packs-mcp-plan.md](./tool-packs-mcp-plan.md). It defines how Strata should add an explicit extension runtime while preserving the shared agent-loop, trace, policy, and local-first invariants.

Pi is the implementation guide for this work. Use the local Pi source under `/home/exedev/Documents/pi-mono` as the behavioral reference, especially:

- `/home/exedev/Documents/pi-mono/packages/coding-agent/docs/extensions.md`
- `/home/exedev/Documents/pi-mono/packages/coding-agent/examples/extensions/README.md`
- `/home/exedev/Documents/pi-mono/packages/coding-agent/src/core/extensions/loader.ts`
- `/home/exedev/Documents/pi-mono/packages/coding-agent/examples/extensions/subagent/`

Do not copy Pi code wholesale. Reimplement the same extension concepts in Strata's package boundaries and naming conventions.

## Objective

Let trusted local TypeScript modules extend Strata without modifying core packages for every workflow.

Extensions should be able to:

- Register model-callable tools.
- Override or wrap selected built-in tools.
- Register slash commands, shortcuts, and launch flags for CLI/TUI/web surfaces where applicable.
- Subscribe to lifecycle events around sessions, turns, model requests/responses, tool calls/results, input, compaction, and shutdown.
- Add prompt/context snippets and dynamic resources such as prompts, skills, and themes.
- Register optional model providers or model aliases.
- Customize TUI rendering and UI affordances through a bounded UI API.
- Coordinate with other extensions through a local event bus.

The extension system should make features such as permission gates, project-local workflow tools, subagent orchestration, plan mode, custom providers, remote execution, prompt customization, and rich TUI widgets possible outside the core harness.

## Design Principles

- **Pi-shaped API:** follow Pi's extension model closely enough that Pi examples can be ported by translation rather than redesign.
- **Strata-owned runtime:** extension hooks must compose with `runAgentLoopEvents()`, `ToolRegistry`, `SessionStore`, and web/TUI event streams rather than bypassing them.
- **Explicit trust:** extensions execute local code with local permissions. Loading must be opt-in and visible; project-local extensions require a trust decision.
- **Trace-backed behavior:** extension-loaded tools and lifecycle decisions should be visible in session events/traces where they affect agent behavior.
- **Policy preserving:** extensions must not bypass core file/write policy, raw-source immutability, secret handling, or session persistence invariants.
- **Interface parity over time:** start with headless tool/hook support, then add TUI UI hooks, then expose safe web control-plane management.

## Non-Goals

- Do not add a marketplace, automatic remote package execution, or silent install/update path.
- Do not make arbitrary third-party extensions available by default.
- Do not let extensions write secrets into wiki pages, traces, memory, skills, proposals, or browser-rendered data.
- Do not let extension tools mutate `wiki/raw/` or delete decision pages.
- Do not fork the agent loop for extension behavior; extensions hook into the same shared runtime.
- Do not require extensions for core Strata functionality such as wiki search, source ingestion, or maintenance jobs.

## Extension Locations And Trust

Support two local extension roots, mirroring Pi's user/project split:

```text
.strata/extensions/          # user/local Strata-owned extensions for this repo/runtime
.agents/extensions/          # project-local extension compatibility root
```

Later, if global user config becomes necessary, add a user-level directory under the Strata config home. Keep the first implementation repo-local so it remains easy to inspect and test.

Loading rules:

- Extensions are disabled by default until an explicit config enables them.
- User/local extensions can be enabled through `.strata/extensions.json` or a CLI/TUI command.
- Project-local extensions require an explicit trust decision per repo.
- Extension status must be inspectable through CLI and eventually web control plane.
- Failed extension load should not crash Strata startup unless the caller requested strict mode.

Suggested config:

```json
{
  "enabled": true,
  "trustedProjectExtensions": false,
  "extensions": {
    "permission-gate": { "enabled": true },
    "subagent": { "enabled": false }
  }
}
```

## Package Boundaries

Add a first-party extension runtime package:

```text
packages/
  extensions/
    src/
      api.ts
      loader.ts
      runtime.ts
      events.ts
      commands.ts
      flags.ts
      resources.ts
      trust.ts
      ui.ts
      providerRegistry.ts
      examples/
```

Dependency direction:

- `@strata/extensions` may depend on `@strata/core`, `@strata/tools`, and shared types from `@strata/agent` only where needed.
- `@strata/agent` should not import concrete extension packages or third-party extension code.
- CLI/TUI/web-api composition code builds an `ExtensionRuntime`, lets it register tools/hooks/resources, then passes the resulting registry/context into the shared agent loop.
- External tool packs from [tool-packs-mcp-plan.md](./tool-packs-mcp-plan.md) can be implemented as extensions or as direct composition packages, but the tool abstraction remains one `ToolRegistry`.

## Extension API Shape

Mirror Pi's default-export factory pattern:

```ts
import type { ExtensionAPI } from "@strata/extensions";

export default function strataExtension(strata: ExtensionAPI): void | Promise<void> {
  strata.on("tool_call", async (event, ctx) => {
    // inspect or block tool calls
  });

  strata.registerTool({
    name: "example.greet",
    description: "Generate a greeting",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string" } },
      required: ["name"],
    },
    mode: "read",
    async handler(args) {
      return { text: `Hello, ${args.name}` };
    },
  });

  strata.registerCommand("hello", {
    description: "Say hello",
    handler: async (_args, ctx) => ctx.ui.notify("Hello", "info"),
  });
}
```

Initial `ExtensionAPI` methods should follow Pi's naming where possible:

- `on(eventName, handler)` for lifecycle hooks.
- `registerTool(definition)` for model-callable tools.
- `registerCommand(name, options)` for slash commands.
- `registerShortcut(shortcut, options)` for TUI shortcuts once keybinding support is ready.
- `registerFlag(name, options)` for CLI/TUI launch flags.
- `registerProvider(name, config)` / `unregisterProvider(name)` after provider composition is extension-aware.
- `getActiveTools()`, `getAllTools()`, `setActiveTools(names)`.
- `getModel()`, `setModel(model)`, `getThinkingLevel()`, `setThinkingLevel(level)` where the surface supports those controls.
- `sendMessage()` and `sendUserMessage()` for extension-driven turns after the run/session runtime can safely serialize them.
- `events` as a local inter-extension event bus.

## Lifecycle Events

Implement event families in phases. Names should stay close to Pi's vocabulary unless Strata has an existing term that would be clearer.

Phase 1 headless events:

- `extension_load`
- `resources_discover`
- `session_start`
- `session_shutdown`
- `before_agent_start`
- `agent_start`
- `agent_end`
- `turn_start`
- `turn_end`
- `context`
- `before_model_request`
- `after_model_response`
- `tool_call`
- `tool_result`
- `input`

Phase 2 session/control events:

- `session_before_switch`
- `session_before_fork`
- `session_before_compact`
- `session_compact`
- `model_select`
- `thinking_level_select`
- `user_bash`

Phase 3 UI/render events:

- message render/update hooks
- tool render hooks
- status/footer/header/widget changes
- overlay/custom component lifecycle

Blocking hooks such as `tool_call`, `session_before_switch`, and `input` should return structured decisions, not throw raw exceptions for expected denials.

## Tools And Tool Overrides

Extension tools should register ordinary Strata `ToolDefinition`s. That means they inherit:

- dotted tool names
- JSON-schema inputs
- `mode` profile filtering
- optional `executionMode`
- result truncation
- cancellation via `ToolContext`
- trace-backed tool events

Allow overriding built-in tools only when explicitly enabled, and record an event listing the replaced tool. This enables Pi-style workflows such as SSH/remote filesystem tools or permission-wrapped bash while keeping the default path safe.

Recommended phases:

1. Register additive extension tools only.
2. Add explicit wrapper/override support for known built-ins: `fs.read`, `fs.grep`, `fs.find`, `fs.list`, `fs.write`, `fs.edit`, `shell.run`, and wiki tools.
3. Add TUI/web renderers for extension tool calls.

## Commands, Flags, And Shortcuts

Commands and flags should be surface-neutral definitions consumed by each frontend:

```ts
interface ExtensionCommand {
  description: string;
  usage?: string;
  handler(args: string, context: ExtensionCommandContext): Promise<void> | void;
}
```

- CLI can expose extension commands under `strata ext run <command>` or as subcommands only after conflict rules are clear.
- TUI should merge extension commands into the slash-command registry.
- Web chat should expose only commands marked browser-safe.
- Flags should be parsed by CLI/TUI startup composition before sessions begin.
- Shortcuts are TUI-only until web keyboard shortcut contracts exist.

## UI API

Use Pi as the target but phase it in after headless hooks are stable.

Initial UI context:

- `ctx.ui.notify(message, level)`
- `ctx.ui.confirm(title, message, options?)`
- `ctx.ui.select(title, options, config?)`
- `ctx.ui.setStatus(id, text | null)`
- `ctx.ui.setWidget(id, content | null, placement?)`
- `ctx.ui.setEditorText(text)` where a surface supports it

Later UI context:

- custom TUI components
- custom editor component
- header/footer overrides
- hidden-thinking/working indicator customization
- message and tool renderers
- overlay APIs

Web support must be deliberately smaller than TUI support. Browser-exposed extension UI must not leak secrets and should go through typed local API events rather than arbitrary browser code injection.

## Provider Extensions

Provider extensions should register through model-factory composition, not by mutating global state hidden from sessions.

Support:

- provider aliases and model definitions
- OpenAI-compatible and Anthropic-compatible streamers
- custom streaming adapters later
- OAuth/status helpers only through local secret stores

Provider registration should emit non-secret metadata events and surface availability in CLI/TUI/web model pickers.

## Dynamic Resources

Add a `resources_discover` hook for extensions to contribute:

- skills
- prompt templates
- themes
- agent/subagent definitions
- command documentation

Resource contributions should be normalized into Strata-owned runtime views rather than directly writing `.strata/skills` or wiki pages unless the extension explicitly calls a write tool and passes policy checks.

## Subagent Extension Reference

Subagents should not be a core agent-loop primitive initially. Instead, follow Pi's example extension:

- A `subagent` extension registers a tool.
- The tool launches isolated Strata runs as child processes or child `runAgentLoopEvents()` jobs.
- It supports single, parallel, and chained tasks.
- Agent definitions live as Markdown with frontmatter for `name`, `description`, `tools`, and `model`.
- Child output is summarized and returned to the parent model with clear caps.
- Child sessions/traces are persisted and linked to the parent run.
- Cancellation propagates from the parent tool call to child runs.

This gives Claude Code/Codex-style delegation while preserving Strata's trace and policy model.

## Security And Policy

Extensions are trusted code, but Strata should still provide guardrails:

- show enabled extensions and source paths in startup/status output
- require trust for project-local extensions
- profile-gate extension tools like built-ins
- route writes through the same policy layer when using Strata tools
- mark extension-originated events in traces
- never serialize secrets to browser-safe DTOs or traces
- provide a safe mode that disables extensions for debugging

## Implementation Sequence

1. Add `docs/extensions-plan.md` to the roadmap and keep existing tool-pack/MCP work as a narrower integration path.
2. Create `@strata/extensions` with core types, loader, trust/config reading, event bus, and tests.
3. Compose the extension runtime into CLI `query` with additive tool registration only.
4. Add lifecycle events around context build, model requests/responses, tool calls/results, and session shutdown.
5. Add extension status/list CLI commands and safe-mode flags.
6. Add TUI slash-command integration, notifications, confirmations, and status/widget hooks.
7. Add command/flag/shortcut APIs across CLI/TUI, then browser-safe command exposure for web chat.
8. Add provider registration support through the shared model factory.
9. Add tool override/wrapper support with explicit warnings and trace events.
10. Port Pi-inspired example extensions: permission gate, protected paths, todo, prompt customizer, plan mode, SSH/remote execution, and subagent.
11. Add web control-plane extension management: list, enable/disable, trust project extensions, inspect commands/tools/resources.
12. Add package/dependency support only after local extension loading and trust semantics are stable.

## Acceptance Criteria

- A local extension can register a read-only tool and the model can call it through the normal trace path.
- A local extension can observe and block a dangerous `shell.run` call with a structured denial.
- TUI slash commands include extension commands and can call `ctx.ui.notify`.
- Extension startup status lists enabled extensions and failed loads.
- Safe mode disables all extensions.
- Project-local extensions require an explicit trust decision.
- Extension tool calls respect profiles, cancellation, result truncation, and file/write policies.
- A subagent example can run a child Strata session, return capped output to the parent, link traces, and propagate cancellation.
