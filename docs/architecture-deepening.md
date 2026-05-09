# Architecture Deepening Candidates

Status: review document, dated 2026-05-02. Not a plan of record.

This document records four architectural deepening opportunities in the Strata
harness. The aim is to surface places where the current code is shallow — where
the interface is nearly as complex as the implementation, where complexity has
spread across callers that should have been able to ignore it, or where the seam
sits in the wrong place. Each candidate is grounded in concrete files and
applies the deletion test: imagine deleting the module; if complexity vanishes
the module was a pass-through, but if complexity reappears across N callers it
was earning its keep.

The vocabulary is deliberate. **Module** means anything with an interface and
an implementation. **Interface** is everything a caller must know to use a
module — types, invariants, error modes, ordering, configuration. **Depth** is
leverage at the interface: a deep module has a lot of behaviour behind a small
interface. **Seam** is the place where an interface lives, where behaviour can
be altered without editing in place. **Adapter** is a concrete thing that
satisfies an interface at a seam. Two adapters means a real seam; one means a
hypothetical seam.

This document does not propose specific TypeScript signatures. Those belong in
follow-up grilling sessions on whichever candidates the team chooses to pursue.

## Candidate Summary

| # | Candidate | Status | Urgency |
|---|---|---|---|
| 1 | Wiki tools duplicate the path-policy module | Real seam in `policy.ts`; wiki tools edit in place | Blocks the tool-expansion milestone |
| 2 | Model adapters re-implement HTTP plumbing | Real seam at `ModelAdapter`; interface is too narrow | Pays back when the third adapter lands |
| 3 | The agent loop has nowhere to grow context construction | Internal seams missing; learning loop has no attachment point | Blocks memory/skills/todos/reflection |
| 4 | Tool-argument parsing leaks across the `ToolRegistry` seam | Two callers, both reinvent the parser | Low-risk; useful warm-up |

## 1. The Path-Policy Module Is the Seam, but `wikiTools` Duplicates It

### Files

- `packages/tools/src/policy.ts`
- `packages/tools/src/wikiTools.ts`
- `packages/tools/src/fsTools.ts` (currently uncommitted)

### Problem

`policy.ts` already concentrates path safety: `resolveRepoPath`,
`assertReadAllowed`, `assertWriteAllowed`, `isRawPath`, blocked-segment
rejection (`.git`, `.strata`, `node_modules`, `dist`), raw-write forbidden,
raw-read gated on `includeRaw`. These are the load-bearing invariants for the
"local-first, raw sources immutable" design commitment in `roadmap.md`.

`fsTools.ts` (the new module the milestone calls for) calls into `policy.ts`
cleanly: every handler runs `assertReadAllowed(context.repoRoot, path, ...)`
before touching the disk. The seam is well used.

`wikiTools.ts` does not cross that seam. It reimplements the same invariants
inside its own `resolveWikiPath` (`wikiTools.ts:266`), with parallel copies of
`isPathInside`, `rejectBlockedSegments`, `EXCLUDED_DIRS`, and `toPosixPath`. The
two implementations encode the same rules with slightly different flag plumbing
and slightly different error codes, and they will drift apart the moment the
policy changes. When guarded `fs.edit` and `fs.write` land — the next
milestone — the new write rules will need to be re-applied to wiki tools by
hand.

This is precisely the situation the roadmap's tool-expansion milestone calls
out: _"Keep existing wiki tools as focused wrappers on top of the broader file
tools."_ That sentence is an architectural directive that has not been carried
out yet.

### Solution

Treat `policy.ts` as the single seam for repo path safety, and have all three
classes of tools (current `wiki.*`, new `fs.*`, future write/edit) cross that
seam. The wiki tools become focused wrappers: they constrain the resolved path
to live under `wiki/` and otherwise delegate. The walk/grep machinery in
`fsTools.ts` should be reused for `wiki.listPages` and `wiki.search`.

What does not change: the `wiki.*` tool names, their JSON input schemas, their
existing tests, and their public behaviour. Callers (the agent loop, the CLI
`tools call` subcommand, the TUI when it grows tool renderers) are unaffected.

### Justification

- _Leverage._ The next milestone explicitly adds `fs.edit`, `fs.write`, and
  later a gated `shell.run`. Each of those will need to honour
  raw-source immutability and the blocked-segment list. If the rules live in
  one module, the new tools inherit them by construction. If the rules live in
  N tool files, each new tool re-derives them.
- _Locality._ When the rules change — for example, when the wiki schema adds a
  new immutable directory, or when symlinks need to be allowed under specific
  paths — the change happens once. The current state requires changing
  `wikiTools.ts` and `policy.ts` and any new file that copied the pattern.
- _Tests improve._ `policy.test.ts` becomes the single test surface for path
  safety; `wikiTools.test.ts` shrinks to behaviour-of-the-tool tests rather
  than rehearsing path-resolution edge cases the policy tests already cover.
- _Deletion test._ Remove the wiki-side path resolver. Where does the
  complexity go? Into `policy.ts`, which already does the work. The duplicated
  helpers in `wikiTools.ts` were a pass-through, not depth.

## 2. The Two Model Adapters Share an Interface but Re-Implement the Plumbing

### Files

- `packages/agent/src/openaiCodex.ts` (~380 lines)
- `packages/agent/src/openaiCompatible.ts` (~180 lines)
- `packages/agent/src/types.ts`
- `packages/agent/src/providerToolNames.ts`
- `packages/agent/src/model.ts` (the `ModelAdapterError` shared error)

### Problem

`ModelAdapter.complete(request: ModelRequest): Promise<ModelResponse>` is the
external seam, and that part is sound. The interface, however, is too narrow:
it does not commit to anything beyond "send a request, get a normalized
response." Every adapter therefore re-implements the same plumbing.

Things both `OpenAICodexModelAdapter` and `OpenAICompatibleChatModelAdapter` do
independently:

- Construct `RequestInit` with auth headers and a JSON body, attach
  `request.signal` only when defined (`openaiCodex.ts:46-62`,
  `openaiCompatible.ts:62-81`).
- Call a configurable `fetchImpl`, branch on `!response.ok`, throw a
  `ModelAdapterError` with provider-specific text.
- Build a tool-name canonicalization map via `createProviderToolNameMap` and
  round-trip names on input and output.
- Map `ToolMetadata` into the provider's tool shape and `AgentMessage` into the
  provider's message shape.
- Normalize provider tool-call payloads back into `AgentToolCall[]`, including
  fallback IDs and `argumentsText: "{}"` defaults.

The provider-specific code is the SSE parser in `openaiCodex.ts:178-305` and
the JSON shape codec in `openaiCompatible.ts:116-183`. Everything else is
duplicated.

Two adapters in production means the seam is real, not hypothetical. But the
interface today does not absorb the duplication, and the third adapter (a new
provider, a Codex schema bump, an Anthropic adapter once Strata grows beyond
OpenAI-compatible models) will copy the same plumbing a third time.

### Solution

Keep `ModelAdapter` as the external interface — the loop in
`packages/agent/src/agentLoop.ts` should be unaffected. Introduce a deeper
internal seam between the adapters and the wire: a small **request transport**
that owns HTTP, error mapping, signal propagation, and tool-name
canonicalization, and a small **shape codec** interface that each provider
implements. The codec is a pure transformation between
`{messages, tools}` and the provider's request body, plus a parser from the
provider's response (JSON object or SSE event stream) into `ModelResponse`.

Each adapter shrinks to: a codec, an endpoint URL, and per-call header
construction. New adapters become a codec, not a re-implementation.

### Justification

- _Leverage._ A new provider becomes the part that is genuinely
  provider-specific — the codec — and inherits everything else.
- _Locality._ Cross-cutting concerns the harness will eventually want — usage
  reporting, retry on 429, structured rate-limit handling, request logging
  into the trace, redaction of auth headers — land in the transport once.
  Today they would have to be added twice, or three times, with the risk that
  each adapter does it slightly differently.
- _Tests improve._ Codecs are pure functions on JSON. Their unit tests do not
  need a `fetchImpl` mock. Today, `openaiCodex.test.ts` and
  `openaiCompatible.test.ts` both stand up `fetch` mocks just to verify
  tool-name canonicalization or signal propagation; that test debt would
  collapse onto the transport.
- _Deletion test._ Delete the transport. The HTTP construction, signal
  attachment, error normalization, and name canonicalization reappear in every
  adapter. The duplication today is the proof that this complexity earns its
  keep behind a single seam.

### Caveat

The Codex SSE parser is genuinely complex — it has its own state machine for
`response.output_item.added`, `response.function_call_arguments.delta`,
`response.function_call_arguments.done`, etc. The shape codec interface needs to
accommodate "parse a stream" as well as "parse a JSON object." The grilling
session for this candidate should establish that interface before any code
moves.

## 3. The Agent Loop Has Nowhere to Grow Context Construction

### Files

- `packages/agent/src/agentLoop.ts` — `runAgentLoopEvents` (~300 lines, plus
  helpers)

### Problem

The harness invariant is _"the agent loop is the source of truth"_, and that
invariant is well honoured: `runAgentLoop()` is a thin consumer of
`runAgentLoopEvents()`, and `agentLoopEvents.test.ts` exercises the canonical
event stream. That part should not change.

However, `runAgentLoopEvents` does too much at one level of abstraction. In one
function it owns:

- repo-path resolution and session-store opening,
- default tool-registry construction,
- the system prompt — currently a hard-coded five-line read-only wiki message
  in `createInitialMessages` (`agentLoop.ts:267`),
- iteration and tool-call budget accounting,
- abort-signal propagation across model calls and tool calls,
- model-adapter invocation and `model.response` event persistence,
- tool-argument JSON parsing (`parseToolArguments`, `agentLoop.ts:348`),
- tool-call execution through the registry and `tool.call` / `tool.result`
  event persistence,
- final `agent.completed` / `agent.failed` shaping with stop-reason logic.

The very next item on the roadmap (`status.md` row "Agent loop") is _"Generalize
context construction for memory, skills, active todos, and richer tool
profiles."_ Today there is no place to put memory injection, skill selection,
active-todo seeding, or per-run system-prompt fragments. They would all
attach to `createInitialMessages`, which is a private helper inside the loop
file with no seam, no test surface of its own, and no way for new subsystems
to compose into it.

Reflection — also a near-term item — has no hook point on the way out, either.

The deletion test for the loop body itself comes back "yes, concentrates": the
loop earns its keep. The deletion test for `createInitialMessages` and
`parseToolArguments` comes back "no, just moves it" — those are pass-through
helpers that should live behind real seams.

### Solution

Pull two internal seams out of the loop without changing its external interface
(`runAgentLoopEvents` keeps its signature and event shapes):

- A **run-context builder** that takes the question, repo state, memory store,
  skills store, and active todos, and produces the seeded `AgentMessage[]`
  plus any per-run system-prompt fragments. Today this is the four-line
  `createInitialMessages(question)`. After deepening, it becomes the place
  where memory recall, skill selection, and todo injection compose.
- A **tool-call executor** that owns argument parsing, the `tools.safeExecute`
  call, and `tool.call` / `tool.result` event persistence.

After the change, the loop is approximately: build initial context → iterate →
call model → either finish or run executor → enforce budgets → persist
lifecycle events. Roughly 100 lines instead of 300, with iteration logic, abort
handling, and lifecycle persistence concentrated in one place.

### Justification

- _Leverage._ The next four learning-loop milestones — memory, skills, todos,
  reflection — all have a defined attachment point. The shape of "what goes
  into a run" lives in the context builder; the shape of "what happens after
  a run" lives at the loop's tail. Today, all four would have to mutate the
  loop body directly.
- _Locality._ Budget enforcement, abort propagation, and lifecycle event
  shaping concentrate in the loop. Context-shape concerns concentrate in the
  context builder. Tool-execution concerns concentrate in the executor.
- _Tests improve._ Context construction becomes a pure function exercisable
  without standing up a mock model adapter. Today, `agentLoop.test.ts` has to
  open a session store and run a fake model just to verify how messages are
  seeded.
- _Deletion test._ Delete the context builder: context-shaping logic spreads
  across every learning-loop subsystem (memory writes its own message, skills
  writes its own, todos writes its own). Delete the executor: argument parsing
  and event persistence move back into the loop. Both come back, which is the
  signal that both modules are deep, not pass-through.

### Constraint to preserve

The end-to-end cancellation invariant (`AgentRunConfig.signal` →
`ModelRequest.signal` → loop iteration boundaries → tool-call boundaries →
status `interrupted`, stoppedReason `cancelled`) must survive intact. The
grilling session should sketch how the executor honours `signal` before any
code moves.

## 4. Tool-Argument Parsing Leaks Across the `ToolRegistry` Seam

### Files

- `packages/tools/src/registry.ts` — `safeExecute` (`registry.ts:70`)
- `packages/agent/src/agentLoop.ts` — `parseToolArguments` (`agentLoop.ts:348`)
- `packages/cli/src/index.ts` — `cmdTools` `call` branch (`cli/src/index.ts:252`)

### Problem

`ToolRegistry.safeExecute(name, args, context)` takes a `JsonObject`. The
question of "is this argument blob actually a JSON object?" lives outside the
registry, in two places:

- The agent loop receives `argumentsText: string` from the model, runs its own
  `parseToolArguments` helper, and constructs an
  `invalid_tool_args` `ToolExecutionResult` by hand if parsing fails
  (`agentLoop.ts:322-338`).
- The CLI `tools call` subcommand parses raw command-line input through its own
  `parseJsonObject` helper (`cli/src/index.ts:313`), throws a generic `Error`
  on failure, and prints a stack-trace-style message rather than producing a
  structured `ToolExecutionResult`.

Two callers, two parsers, two error-shape conventions. The registry is the
authority on what counts as a valid tool input — the JSON schemas live there,
the policy errors live there — but the parse-from-string step does not.

This is a small leak, but it is the kind of small leak that pulls callers into
duplicating registry concerns. A future TUI tool inspector or a scheduled-job
runner that calls tools from JSON strings will reinvent the parser a third
time.

### Solution

Add a sibling method to `ToolRegistry`, conceptually
`executeFromText(name, argumentsText, context)`, that owns:

- JSON parsing,
- the "must be a non-array object" check,
- structured-error production with the existing `invalid_tool_args` code,
- delegation to the existing `safeExecute` once the args are valid.

Keep `safeExecute` for callers that already have a typed `JsonObject` (tests,
internal handlers). The agent loop drops `parseToolArguments` and the
`ToolArgumentParseResult` type. The CLI `tools call` branch loses its hand-rolled
error path and instead prints the same `ToolExecutionResult` JSON the agent
loop persists.

### Justification

- _Locality._ The contract for "what counts as a valid tool invocation" lives
  in one module, alongside the existing schema and policy validation.
- _Leverage._ A future caller — the TUI's tool inspector, the scheduled
  maintenance runner from the roadmap, an HTTP debug endpoint — calls one
  method and gets the right error shape for free.
- _Tests improve._ Today the invalid-args path is tested at the loop level,
  which requires a session store and a fake model that emits a malformed
  tool-call. After the change, it can be tested directly against the registry.
- _Deletion test._ Delete `executeFromText`. The parsing reappears in both
  callers. Two callers means a real seam. The seam should be in the registry.

This candidate is small and self-contained. It is a useful warm-up before
candidates 2 or 3 if the team wants to validate the deepening approach with low
risk.

## How These Candidates Relate

The four candidates are independent, but they compose well in this order:

1. _Candidate 1_ removes a duplication that is already blocking the
   tool-expansion milestone. Doing it first means new `fs.edit` / `fs.write`
   tools land against a single policy seam.
2. _Candidate 4_ is small and tightens the registry interface. Doing it
   second means later candidates work against a registry whose
   tool-invocation contract is fully owned.
3. _Candidate 3_ creates the attachment points for the next four learning-loop
   milestones (memory, skills, todos, reflection). Doing it third means each
   of those milestones is a new module composing into the context builder,
   not a new branch inside `runAgentLoopEvents`.
4. _Candidate 2_ has the highest payoff per line of code, but the smallest
   urgency until a third model provider is on the table. It can wait for the
   next adapter, which is the natural moment to design the transport / codec
   split.

## What This Document Is Not

This is not a plan of record. The roadmap and the per-area plans
(`agent-harness-plan.md`, `wiki-plan.md`, `tui-plan.md`) remain authoritative.
If any of these candidates are adopted, the roadmap and the relevant plan
should be updated first, and this document should be amended to record what was
adopted, what was rejected, and why.

This is also not a refactoring playbook. None of these candidates includes
proposed TypeScript signatures or step-by-step migration sequences. Those
should come out of grilling sessions on whichever candidates the team chooses
to pursue, and they belong alongside the actual code changes — not here.
