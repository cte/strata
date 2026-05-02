# Cortex Agentic Harness Implementation Plan

Status: Phase 2 implementation complete.

This plan supersedes immediate work on the raw-source wiki automation. The next major objective is to build a small Bun/TypeScript agentic harness that can eventually maintain and query the Cortex wiki. Hermes Agent is the reference architecture, but Cortex should copy the loop patterns, not the platform scope.

## 1. Objective

Build a local agent harness that can:

1. Run a bounded tool-calling loop against a model.
2. Read, search, update, and lint the Cortex wiki through explicit tools.
3. Persist every run as a trace so future runs can recall prior work.
4. Learn from experience by maintaining user memory, operational memory, reusable skills, and schema proposals.
5. Keep raw source material immutable and keep high-risk changes reviewable.

The end state is not "a chatbot over Markdown." The end state is a durable work assistant with a feedback loop: it works, records what happened, extracts reusable lessons, improves its operating instructions, and uses those improvements in the next session.

## 2. Non-Goals

- Do not clone Hermes wholesale.
- Do not build gateways, TUI, cron, plugin marketplaces, multi-provider routing, subagents, or browser/terminal automation in the first version.
- Do not fine-tune models. "Learning" means improving durable context artifacts and retrieval indexes.
- Do not give the model a generic shell tool by default. Wiki tools should be narrow and auditable.
- Do not auto-edit `raw/` under any circumstance.

## 3. Design Principles

- Deterministic core: the harness owns state transitions, tool validation, file boundaries, and trace persistence.
- Narrow tools: expose explicit wiki and learning tools before exposing broad filesystem or shell tools.
- Durable traces: every model call, tool call, tool result, file patch, reflection, and proposal is stored.
- Learning is first-class: reflection, memory, skill updates, and curator passes are product features, not afterthoughts.
- Human control for schema drift: automatic learning may update low-risk memory and telemetry; schema changes and broad operating-rule changes should be staged for review.
- Immutable evidence: raw source documents and historical traces are append-only.
- Recoverable writes: write through patches, preserve previous versions in git, and record why a change was made.

## 4. Hermes Patterns To Adapt

Hermes mechanisms worth adapting:

- Agent loop: bounded `messages -> model -> tool_calls -> tool_results -> repeat`.
- Tool registry: tool schemas, handlers, availability checks, and per-tool result contracts.
- Session store: SQLite-backed sessions plus search over prior conversations.
- Skills: procedural memory as editable Markdown files with optional references/templates/scripts.
- Memory: bounded user/operational memory injected into future runs.
- Background review: a second pass reviews completed work and proposes memory/skill updates.
- Curator: periodic maintenance consolidates stale or overlapping skills.

Hermes mechanisms to defer:

- Gateways and messaging platforms.
- TUI and ACP adapters.
- Generic terminal/browser tool surface.
- Multi-provider fallback matrix.
- Plugin loading system.
- Cron/kanban/subagent systems.
- External memory providers such as Honcho or Mem0.

## 5. Proposed Directory Layout

Project source uses a Bun workspace monorepo. Package boundaries are intentional: shared runtime primitives live in `@cortex/core`, the command surface lives in `@cortex/cli`, and later agent/tool/learning packages can be added without turning the repo into one large import graph.

```text
packages/
  core/
    src/
      events.ts
      paths.ts
      sessionStore.ts
      types.ts
  cli/
    src/
      index.ts
  agent/
    src/
      agentLoop.ts
      context.ts
      model.ts
      policy.ts
  tools/
    src/
      registry.ts
      wikiTools.ts
      learningTools.ts
  learning/
    src/
      reflection.ts
      memoryStore.ts
      skillStore.ts
      curator.ts
      proposals.ts
src/
  tools/
    lintWiki.ts
    pullGranola.ts
    pullSlack.ts
    pullNotion.ts
```

Harness runtime state:

```text
.cortex/
  state.sqlite
  traces/
    <session-id>.jsonl
  memory/
    USER.md
    OPERATIONS.md
  skills/
    ingest-meeting/
      SKILL.md
      references/
      templates/
    query-wiki/
      SKILL.md
      references/
      templates/
  proposals/
    YYYY-MM-DDTHHMMSSZ-<slug>.md
  reports/
    reflections/
    curator/
```

Wiki content remains in the existing top-level Markdown directories:

```text
priorities.md
me.md
index.md
log.md
raw/
people/
projects/
teams/
meetings/
decisions/
threads/
actions/
meta/
```

The `.cortex/` directory stores agent runtime state. The wiki stores user-facing knowledge. This separation prevents operational learning artifacts from polluting the work wiki while still allowing approved learning to update `CLAUDE.md`, `me.md`, and wiki pages.

## 6. Runtime Architecture

### 6.1 CLI

Initial command surface:

```text
cortex chat
cortex query "<question>"
cortex ingest raw/granola/<file>.md
cortex lint
cortex learn reflect <session-id>
cortex learn curator
cortex sessions list
cortex sessions search "<query>"
```

Implementation target:

- `packages/cli/src/index.ts` parses commands.
- Commands build an `AgentRunConfig`.
- Commands call `runAgentLoop()` or deterministic non-agent workflows.
- Every command creates or resumes a session.

### 6.2 Agent Loop

`packages/agent/src/agentLoop.ts` owns the core loop.

Responsibilities:

- Build initial messages from system prompt, memory, relevant skills, session context, and user input.
- Call the configured model adapter.
- Normalize model responses into `{content, toolCalls, finishReason, usage}`.
- Validate tool names and JSON arguments.
- Execute tool calls through the registry.
- Append tool result messages.
- Stop on final answer, max iterations, max tool calls, model error, or guardrail halt.
- Persist events throughout the run.
- Trigger the post-run reflection loop.

First version constraints:

- Max iterations default: 12.
- Max tool calls per run default: 40.
- Tool calls execute sequentially at first.
- Tool results above a size threshold are summarized or persisted to trace files and replaced with a preview.
- No streaming in the first version.

### 6.3 Model Adapter

`packages/agent/src/model.ts` should expose one internal interface:

```ts
export interface ModelAdapter {
  complete(request: ModelRequest): Promise<ModelResponse>;
}
```

Start with OpenAI-compatible API-key auth and a dedicated OpenAI Codex adapter for ChatGPT subscription auth. Keep the adapter seam so provider changes do not affect the agent loop or tool registry.

The adapter should normalize:

- Assistant text.
- Tool calls.
- Finish reason.
- Token usage when available.
- Provider-specific IDs for traceability.

### 6.4 Tool Registry

`packages/tools/src/registry.ts` owns tool registration and dispatch.

Each tool has:

- `name`
- `description`
- JSON schema
- `handler(args, context)`
- `mode`: `read`, `write`, `learning`, `dangerous`
- `maxResultChars`
- optional `available()`

The registry must:

- Return model-facing tool definitions.
- Reject unknown tools.
- Validate arguments before dispatch.
- Record start/end/error events.
- Enforce policy checks before writes.

### 6.5 Policy Layer

`src/harness/policy.ts` owns guardrails.

Hard rules:

- No writes under `raw/`.
- No deletion of decision pages.
- No unreviewed changes to `CLAUDE.md`.
- No secrets in wiki pages, traces, memory, skills, or proposals.
- No writes outside the Cortex repo.
- No broad recursive rewrites without explicit user approval.

Policy decisions should return structured results:

```ts
type PolicyDecision =
  | { allow: true }
  | { allow: false; reason: string; stagedProposal?: boolean };
```

## 7. Core Tools

### 7.1 Wiki Read Tools

`wiki.readPage`

- Reads one wiki page.
- Rejects binary files and files outside the repo.
- Returns frontmatter, body, size, and last modified time.

`wiki.listPages`

- Lists pages by entity type or directory.
- Can include frontmatter summaries.

`wiki.search`

- Uses SQLite FTS if available.
- Falls back to `rg`-style text search if the index is missing.
- Returns ranked file snippets.

`wiki.backlinks`

- Finds pages linking to a page or wikilink label.

### 7.2 Wiki Write Tools

`wiki.writePage`

- Creates a new wiki page.
- Requires frontmatter unless writing a known special file like `log.md`.
- Fails if the path already exists unless `overwrite: true` is explicitly allowed by policy.

`wiki.patchPage`

- Applies a targeted text replacement or structured section replacement.
- Must fail when the target match is ambiguous.
- Must record old/new previews in the trace.

`wiki.appendLog`

- Appends a timestamped entry to `log.md`.
- This is the only general append tool for the activity log.

`wiki.updateIndex`

- Adds or updates index entries in a deterministic format.
- Should be preferred over freeform index edits.

### 7.3 Learning Tools

`learning.readMemory`

- Reads `.cortex/memory/USER.md` and `.cortex/memory/OPERATIONS.md`.

`learning.proposeMemoryUpdate`

- Stages a memory update proposal.
- The reflection loop may auto-apply low-risk memory updates after policy checks.

`learning.readSkills`

- Lists `.cortex/skills/*/SKILL.md` metadata.

`learning.viewSkill`

- Loads a skill and optional support file.

`learning.proposeSkillPatch`

- Stages a patch or create proposal for a skill.

`learning.proposeSchemaChange`

- Stages a proposed `CLAUDE.md` change. Never auto-applies initially.

`learning.sessionSearch`

- Searches prior sessions/traces and returns summaries with session IDs.

## 8. Session Store And Trace Design

Use `.cortex/state.sqlite` as the primary index and `.cortex/traces/*.jsonl` as append-only raw event logs.

### 8.1 SQLite Tables

Initial tables:

```sql
sessions(
  id text primary key,
  title text,
  kind text,
  started_at text,
  ended_at text,
  status text,
  model text,
  git_commit text
)

events(
  id integer primary key,
  session_id text,
  ts text,
  type text,
  payload_json text
)

messages(
  id integer primary key,
  session_id text,
  role text,
  content text,
  tool_call_id text,
  tool_calls_json text,
  ts text
)

tool_calls(
  id text primary key,
  session_id text,
  name text,
  args_json text,
  result_preview text,
  status text,
  started_at text,
  ended_at text
)

file_changes(
  id integer primary key,
  session_id text,
  path text,
  change_type text,
  before_hash text,
  after_hash text,
  diff text
)

reflections(
  id integer primary key,
  session_id text,
  status text,
  summary text,
  created_at text
)

proposals(
  id text primary key,
  session_id text,
  kind text,
  path text,
  status text,
  created_at text
)
```

Add FTS over `messages.content`, `tool_calls.name`, `tool_calls.args_json`, `tool_calls.result_preview`, and `events.payload_json`.

### 8.2 Event Types

The JSONL trace should include:

- `session.started`
- `message.user`
- `message.system_context`
- `model.request`
- `model.response`
- `tool.started`
- `tool.completed`
- `tool.failed`
- `file.changed`
- `reflection.started`
- `reflection.completed`
- `proposal.created`
- `session.ended`

Trace events should be sufficient to reconstruct what the agent knew and why it wrote each file.

## 9. Learning Loop Design

Learning is the key feature. Cortex should implement several small loops rather than one vague "memory" feature.

### 9.1 Loop A: Run Trace Loop

Purpose: preserve exact experience.

Trigger:

- Every command and agent run.

Writes:

- `.cortex/traces/<session-id>.jsonl`
- `.cortex/state.sqlite`

What it captures:

- User request.
- Context loaded.
- Skills loaded.
- Model responses.
- Tool calls and outputs.
- File changes.
- Final answer.
- Errors and retries.

Why it matters:

- Session search depends on it.
- Reflection depends on it.
- Debugging bad wiki edits depends on it.
- Future model runs can retrieve prior work without asking the user to repeat context.

Acceptance criteria:

- A failed run still has a complete partial trace.
- A file change can be traced back to the specific tool call and model turn that caused it.
- Search can find a past run by user terms, tool names, or changed files.

### 9.2 Loop B: Post-Run Reflection Loop

Purpose: convert experience into reusable knowledge.

Trigger:

- After every agent run that used tools.
- Always after ingest.
- Always after failed or interrupted runs.
- Manually via `cortex learn reflect <session-id>`.

Inputs:

- Session trace.
- Final answer.
- File changes.
- Current memory.
- Skills used.
- Existing pending proposals.

Output categories:

```json
{
  "memory_updates": [],
  "skill_updates": [],
  "schema_updates": [],
  "wiki_followups": [],
  "lint_findings": [],
  "noops": []
}
```

Decision rules:

- User preferences, identity, communication style -> user memory.
- Environment facts, repo conventions, tool quirks -> operations memory.
- Reusable procedure, pitfall, debugging path, or source-specific rule -> skill update.
- Durable wiki convention or entity schema change -> schema proposal.
- Work facts, project state, decisions, commitments -> wiki pages.
- One-off task progress -> trace only, not memory.

Auto-apply policy for v1:

- Auto-apply memory updates only when low risk and short.
- Stage all skill updates as proposals.
- Stage all `CLAUDE.md` changes as proposals.
- Stage all broad wiki restructuring.
- Auto-create lint reports and reflection reports.

Proposal format:

```markdown
---
type: learning-proposal
kind: memory | skill | schema | wiki
session: <session-id>
status: pending
created: YYYY-MM-DDTHH:MM:SSZ
---

# Proposal: <title>

## Reason

## Evidence

## Proposed Change

## Risk

## Apply Command
```

Acceptance criteria:

- Reflection never mutates `raw/`.
- Reflection can explain why each proposal exists with trace evidence.
- Reflection can say "nothing to save" without creating noise.
- Reflection is idempotent for the same session.

### 9.3 Loop C: Memory Loop

Purpose: keep compact durable facts available in future sessions.

Files:

- `.cortex/memory/USER.md`
- `.cortex/memory/OPERATIONS.md`

`USER.md` stores:

- User role.
- Communication preferences.
- Durable working preferences.
- Repeated corrections.
- Important stable personal context relevant to Cortex.

`OPERATIONS.md` stores:

- Repo conventions.
- Tool quirks.
- Model/provider quirks.
- Local environment facts.
- Lessons about running Cortex itself.

Rules:

- Keep memory bounded. Target 2,000-4,000 characters per file at first.
- Write declarative facts, not commands.
- Do not store task progress.
- Do not store secrets.
- Prefer updating an existing entry over appending near-duplicates.
- If a memory becomes obsolete, supersede or replace it rather than leaving contradictions.

Injection into runs:

- Memory is loaded into the system/developer context before each run.
- The current contents should be recorded in the trace as `message.system_context`.

Acceptance criteria:

- If the user corrects the agent's style, future runs see that correction.
- Memory does not grow without bound.
- Memory updates are visible and reviewable.

### 9.4 Loop D: Skill Loop

Purpose: capture procedural knowledge that improves future work.

Skill shape:

```text
.cortex/skills/<skill-name>/
  SKILL.md
  references/
  templates/
  scripts/
```

`SKILL.md` frontmatter:

```yaml
---
name: ingest-granola-meeting
description: How to ingest a Granola transcript into the Cortex wiki.
triggers:
  - ingest raw/granola files
  - summarize meetings
  - extract actions and decisions from transcripts
status: active
---
```

Skill body sections:

- When to Use
- Procedure
- Required Context
- Tools
- Pitfalls
- Verification
- Examples

Initial seed skills:

- `query-wiki`: answer questions using `priorities.md`, `me.md`, `index.md`, candidate pages, and citations.
- `ingest-granola-meeting`: turn transcript into meeting/project/person/decision/thread/action updates.
- `ingest-slack-thread`: decide if a Slack thread is material; update only if it is.
- `ingest-notion-doc`: snapshot and extract durable decisions/commitments.
- `wiki-lint`: weekly health check workflow.
- `learning-reflection`: how to classify trace lessons into memory, skills, schema, or no-op.

Runtime behavior:

- Before each run, build a compact skill index from names/descriptions/triggers.
- The model may call `learning.viewSkill` to load full content.
- Explicit CLI commands can preload skills.
- Loaded skills are recorded in the trace.

Skill update policy:

- The reflection loop stages skill updates when a run reveals a better procedure or missing pitfall.
- The agent may patch skills directly only after we trust the loop; v1 stages proposals.
- Skill updates should prefer patching an existing umbrella skill over creating narrow one-off skills.

Acceptance criteria:

- The second Granola ingest should reuse the `ingest-granola-meeting` skill.
- If the first ingest exposes a missing step, reflection proposes a skill patch.
- Skills remain discoverable by task class, not by one-off issue names.

### 9.5 Loop E: Session Search Loop

Purpose: make prior work retrievable during future reasoning.

Trigger:

- User asks about prior work.
- Agent sees references like "last time", "we did this before", "that Slack thread", "the meeting with X".
- Reflection or ingest needs prior context.
- Manual `cortex sessions search`.

Implementation:

- SQLite FTS over messages/events/tool calls.
- `learning.sessionSearch` returns ranked sessions with snippets.
- Optional second pass summarizes top sessions into a concise recap.

First version:

- FTS snippets plus trace metadata.
- Summarization can be added after base search works.

Acceptance criteria:

- Searching a project/person/decision term finds relevant prior sessions.
- The agent cites session IDs when using session recall.
- Current session is excluded from search results unless explicitly requested.

### 9.6 Loop F: Wiki Evolution Loop

Purpose: let the wiki become more useful over time without turning into noise.

Triggers:

- Ingest finds new entities, decisions, actions, or contradictions.
- Query produces reusable synthesis.
- Lint finds stale or missing structure.
- Reflection identifies schema mismatch.

Actions:

- Update relevant wiki pages.
- Create new decisions/threads/projects/people pages.
- Propose schema changes when a repeated pattern does not fit current `CLAUDE.md`.
- Offer to file reusable query synthesis.

Rules:

- Materiality threshold for Slack is high.
- Decisions are never deleted.
- Contradictions are surfaced, not silently reconciled.
- Reusable synthesis should become a page, not disappear in chat.

Acceptance criteria:

- A query answer can be filed back into the wiki with citations.
- Repeated schema friction produces a `CLAUDE.md` proposal.
- Lint can identify orphan pages, stale threads, stale priorities, and missing decision pages.

### 9.7 Loop G: Curator Loop

Purpose: keep the learning artifacts healthy.

Trigger:

- Manual `cortex learn curator`.
- Later: weekly or after N sessions.

Inputs:

- Skill usage telemetry.
- Skill contents.
- Memory files.
- Reflection proposals.
- Session search summaries.

Responsibilities:

- Merge narrow skills into umbrella skills.
- Archive obsolete skills after approval.
- Detect duplicate or contradictory memory entries.
- Promote repeated proposals into schema changes.
- Identify stale pending proposals.
- Generate a curator report.

Auto-apply policy for v1:

- No automatic skill archiving.
- No automatic memory deletion.
- Curator writes reports and proposals only.

Report output:

```text
.cortex/reports/curator/YYYY-MM-DD.md
```

Acceptance criteria:

- Curator can identify overlapping skills.
- Curator can propose a merge with exact source and destination files.
- Curator can explain why a memory should be replaced or removed.

### 9.8 Loop H: Evaluation Loop

Purpose: prevent learning from making the harness worse.

Add golden tasks:

- Query a known small wiki fixture and require citations.
- Ingest a fixture meeting transcript and check expected pages/actions/decisions.
- Reflect on a fixture trace and check expected memory/skill/schema proposal classification.
- Ensure `raw/` writes are blocked.
- Ensure secrets are redacted from traces and proposals.

Run via:

```text
bun test
bun run check
```

Acceptance criteria:

- Every learning loop has deterministic tests around policy and classification.
- A bad reflection cannot directly corrupt schema or skills in v1.

## 10. Ingest Flow With Learning

`cortex ingest raw/granola/YYYY-MM-DD-title.md`

1. Start session.
2. Load memory.
3. Load skill index.
4. Load `ingest-granola-meeting` skill.
5. Read source file.
6. Search wiki for candidate people/projects/threads/decisions.
7. Ask model for structured extraction:
   - meeting summary
   - touched entities
   - decisions
   - actions
   - open questions
   - contradictions
8. Apply wiki updates through narrow tools.
9. Update `index.md`.
10. Append `log.md`.
11. Commit only after validation passes.
12. Run post-run reflection.
13. Stage learning proposals.
14. Final response summarizes:
   - wiki pages changed
   - decisions/actions opened
   - contradictions
   - learning proposals created

Validation before commit:

- `bun run lint:wiki -- --dry-run`
- no writes under `raw/`
- all new wiki pages have frontmatter
- all index entries point to existing files
- no secret-looking strings introduced

## 11. Query Flow With Learning

`cortex query "<question>"`

1. Start session.
2. Load memory.
3. Load `query-wiki` skill.
4. Read `priorities.md`, `me.md`, and `index.md`.
5. Search wiki and session store for candidate context.
6. Read candidate pages and one-hop linked pages.
7. Synthesize answer with citations.
8. If answer is reusable, create a proposal to file it as a page.
9. Run post-run reflection.

The query command should be allowed to make no wiki changes. Filing synthesis is a separate staged action unless the user explicitly asks to write it.

## 12. Lint Flow With Learning

`cortex lint`

1. Deterministically scan wiki pages.
2. Produce structural findings.
3. Optionally ask the model to classify or group findings.
4. Write `meta/lint/lint-YYYY-MM-DD.md`.
5. Run reflection to identify schema or skill improvements.

Lint checks:

- Open threads older than threshold.
- Stale priorities.
- Missing backlinks.
- Orphan pages.
- Decisions referenced but missing.
- Pages without frontmatter.
- Duplicate entity pages.
- Action items past due.
- Contradictory project statuses.

## 13. Implementation Phases

### Phase 0: Harness Skeleton

Deliverables:

- `.cortex/` runtime directories.
- Bun workspaces under `packages/*`.
- `packages/core/src/types.ts`.
- `packages/core/src/events.ts`.
- `packages/core/src/sessionStore.ts` with session/event persistence.
- `packages/cli/src/index.ts` with stub commands.

Acceptance:

- `cortex sessions list` works.
- A dummy session writes trace events.
- `bun run check` passes.

### Phase 1: Tool Registry And Policy

Deliverables:

- Tool registry.
- Policy layer.
- Wiki read/search/list tools.
- Tests for path boundaries and `raw/` immutability.

Acceptance:

- Unknown tools are rejected.
- Writes outside the repo are rejected.
- Any write under `raw/` is rejected.

### Phase 2: Agent Loop MVP

Deliverables:

- Model adapter.
- ChatGPT OAuth auth store and `openai-codex` provider adapter.
- Sequential tool loop.
- Message normalization.
- Tool-call validation.
- Trace persistence.

Acceptance:

- A model can call `wiki.search` and `wiki.readPage`.
- The loop stops cleanly on final answer or max iterations.
- Tool errors are returned to the model and stored in traces.

### Phase 3: Wiki Write Tools

Deliverables:

- `wiki.writePage`.
- `wiki.patchPage`.
- `wiki.appendLog`.
- `wiki.updateIndex`.
- File-change tracing.

Acceptance:

- New page creation is validated.
- Ambiguous patches fail.
- Every file write creates a trace event.

### Phase 4: Session Search

Deliverables:

- SQLite FTS index.
- `learning.sessionSearch`.
- `cortex sessions search`.

Acceptance:

- Prior sessions can be found by content, tool name, or changed file.
- Search results include session IDs and snippets.

### Phase 5: Memory And Skills

Deliverables:

- `.cortex/memory/USER.md`.
- `.cortex/memory/OPERATIONS.md`.
- Skill store and skill index.
- Seed skills.
- `learning.readMemory`, `learning.readSkills`, `learning.viewSkill`.

Acceptance:

- Agent runs include memory and skill index in context.
- Agent can load a relevant skill.
- Skill loads are recorded in the trace.

### Phase 6: Reflection Loop

Deliverables:

- Reflection prompt and structured output parser.
- Proposal writer.
- Low-risk memory auto-apply policy.
- Manual proposal apply/reject commands.

Acceptance:

- Reflection runs after tool-using sessions.
- Reflection produces no duplicate proposals on rerun.
- Skill/schema updates are staged, not directly applied.

### Phase 7: Query And Ingest Workflows

Deliverables:

- `cortex query`.
- `cortex ingest`.
- Deterministic validations before commit.
- Optional git commit integration.

Acceptance:

- Query answers cite wiki pages.
- Ingest updates expected wiki pages from a fixture raw item.
- Reflection runs after both workflows.

### Phase 8: Curator And Lint Integration

Deliverables:

- `cortex lint`.
- `cortex learn curator`.
- Curator reports and merge proposals.

Acceptance:

- Curator identifies overlapping skills in fixtures.
- Lint writes a report.
- Curator never auto-archives in v1.

### Phase 9: Source Connectors Integration

Deliverables:

- Connect existing pull scripts into harness workflows.
- Track source pulls as sessions.
- Run ingest after source pull when requested.

Acceptance:

- `pull:*` scripts can feed `cortex ingest`.
- Raw source files remain immutable.

## 14. Configuration

Add `.cortex/config.json` or typed config loaded from environment.

Initial fields:

```json
{
  "model": {
    "provider": "openai-codex",
    "model": "",
    "baseUrl": "",
    "apiKeyEnv": "OPENAI_API_KEY",
    "authFile": ".cortex/auth.json"
  },
  "agent": {
    "maxIterations": 12,
    "maxToolCalls": 40,
    "reflectionEnabled": true
  },
  "learning": {
    "autoApplyLowRiskMemory": true,
    "autoApplySkillPatches": false,
    "autoApplySchemaChanges": false
  },
  "wiki": {
    "rawImmutable": true,
    "requireFrontmatter": true
  }
}
```

Secrets stay in `.env`, never config files committed to git.

## 15. Review And Approval Model

Commands:

```text
cortex proposals list
cortex proposals show <id>
cortex proposals apply <id>
cortex proposals reject <id>
```

Proposal statuses:

- `pending`
- `applied`
- `rejected`
- `superseded`

Changes requiring review in v1:

- `CLAUDE.md` edits.
- Skill creates/patches/deletes.
- Memory deletes.
- Any broad wiki reorganization.
- Any automatic rule that would change future agent behavior globally.

Changes allowed automatically in v1:

- Trace writes.
- SQLite indexes.
- Lint reports.
- Reflection reports.
- Low-risk memory additions under length/security limits.
- Query answers with no file writes.

## 16. Security And Data Hygiene

Redaction:

- Scan trace events, proposals, memory, skills, and wiki writes for likely secrets.
- Redact API keys, bearer tokens, Slack tokens, private keys, `.env` contents, and credentials-looking strings.

Write boundaries:

- Tools must resolve absolute paths and confirm they stay within the repo.
- Runtime state writes stay under `.cortex/`.
- Wiki writes stay in approved wiki paths.

Prompt injection:

- Treat raw source files and wiki pages as data, not instructions.
- Load raw source inside fenced context blocks.
- Do not let raw text override harness policy or system instructions.

Auditability:

- Every write includes session ID, tool call ID, and reason.
- Every proposal includes evidence.

## 17. Open Decisions

- Which model provider should be first?
- Should low-risk memory auto-apply be enabled immediately, or should all memory start as proposals?
- Should `me.md` be updated directly from user memory, or only via proposals?
- Should git commits be automatic after successful ingest, or explicitly confirmed?
- Should `.cortex/` be committed, partially committed, or ignored? Recommended: commit seed skills and config examples, ignore traces/state.

## 18. Recommended First Build Slice

The first useful slice should be intentionally small:

1. Session store and trace events.
2. Tool registry and path policy.
3. Wiki read/search tools.
4. Agent loop that can answer `cortex query` with citations.
5. Post-run reflection that writes proposals only.
6. Seed `query-wiki` and `learning-reflection` skills.

Do not start with ingest. Query plus reflection exercises the core loop, retrieval, citations, trace persistence, memory/skill loading, and proposal generation with lower write risk.

Once query is stable, add wiki write tools and fixture-based ingest.
