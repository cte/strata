# Strata Roadmap

Status: canonical top-level planning document.

This document coordinates the lower-level plans in [wiki-plan.md](./wiki-plan.md), [agent-harness-plan.md](./agent-harness-plan.md), [tui-plan.md](./tui-plan.md), [web-chat-plan.md](./web-chat-plan.md), and [web-control-plane-plan.md](./web-control-plane-plan.md). Those documents contain implementation details. This document defines what Strata is, what we are building first, and how the pieces fit together.

Current implementation status: [status.md](./status.md).

## What Strata Is

Strata is a local, agent-maintained personal work system.

It has two tightly connected parts:

1. A Markdown work wiki that captures the user's priorities, projects, people, decisions, meetings, open threads, action items, and source material.
2. A Bun/TypeScript agentic harness that can query, maintain, and improve that wiki through explicit tools, persistent traces, memory, skills, scheduled maintenance jobs, a TUI, a local browser chat UI, and a local web control plane for connector setup.

The wiki is the durable knowledge base. The harness is the working system that keeps the knowledge base useful.

In one sentence:

> Strata is a local Bun/TypeScript agent that helps the user remember, understand, and maintain their work context by operating on a Markdown wiki with safe tools and durable learning loops.

## The Core Product

Strata should answer five recurring user needs:

- What matters right now?
- What happened before, and where is the evidence?
- What do I owe people, and what do they owe me?
- What decisions have we made, and why?
- What has the agent learned that should make the next session better?

The first version should feel less like a general chatbot and more like a disciplined work assistant with a memory-backed operating model.

## System Layers

### 1. Work Wiki

The wiki is user-facing Markdown stored under `wiki/`. It contains pages such as `wiki/priorities.md`, `wiki/me.md`, `wiki/index.md`, `wiki/log.md`, `wiki/people/`, `wiki/projects/`, `wiki/meetings/`, `wiki/decisions/`, `wiki/threads/`, and `wiki/actions/`.

Raw source material lives under `wiki/raw/` and is immutable. The agent may read raw sources but must not edit them.

Detailed plan: [wiki-plan.md](./wiki-plan.md).

### 2. Agentic Harness

The harness is the runtime that calls models, exposes tools, records sessions, and maintains learning artifacts. It lives in the Bun workspace packages under `packages/`.

The harness owns:

- The model/tool loop.
- Tool registration and policy enforcement.
- Session traces and SQLite session state.
- File, wiki, shell, memory, session-search, and skill tools.
- Reflection and learning workflows.
- Scheduled maintenance jobs for recurring wiki hygiene and learning tasks.

Detailed plan: [agent-harness-plan.md](./agent-harness-plan.md).

### 3. TUI

The TUI is the primary interactive interface. It should make agent work visible: messages, tool calls, auth state, model state, sessions, and command flow.

The TUI should be implemented end-to-end in this repo, using Pi as a reference but not as a dependency.

Detailed plan: [tui-plan.md](./tui-plan.md).

### 4. Web Chat

The web chat is a local browser interface for the same agent runtime used by the CLI and TUI. It should stream events from `runAgentLoopEvents()` through `packages/web-api`, render messages and tool calls in `apps/web`, and persist sessions through the existing Strata session store.

The web chat is not a separate browser-side agent and should not shell out to the CLI for normal operation. CLI, TUI, and web chat are three frontends over the shared agent loop.

Detailed plan: [web-chat-plan.md](./web-chat-plan.md).

### 5. Web Control Plane

The web control plane is a future local browser UI for setup and operations, not a separate product and not the ingestion runtime itself. It should expose connector setup, OAuth/token status, dry-run pulls, ingest history, schedules, and proposal review for sources such as Notion, Granola, and Slack.

The web app must call the same connector, scheduler, session, and proposal APIs used by the CLI and TUI. Connector logic belongs in shared packages; the web app is only another interface over those packages. The local API surface is Hono + tRPC so the React client can consume shared router types without duplicating DTO definitions.

Detailed plan: [web-control-plane-plan.md](./web-control-plane-plan.md).

## Learning Loops

Learning is not model training. In Strata, learning means improving durable local artifacts that future sessions can use.

Strata should learn through:

- Session traces: every meaningful agent run is persisted.
- Memory: durable user and project facts that prevent repeated steering.
- Skills: reusable procedural knowledge for recurring workflows.
- Reflection: post-run review that identifies what should be saved or improved.
- Curator passes: periodic cleanup of stale, duplicated, or low-quality learning artifacts.

The learning loop is central to the product, not an optional later feature.

## What We Are Not Building

Strata is not trying to be:

- A general-purpose clone of Hermes, Claude Code, Codex, or Pi.
- A cloud SaaS product.
- A multi-user team knowledge base.
- A full automation platform with arbitrary integrations by default.
- A web server exposed to the public internet.
- A replacement for the user's source systems such as Slack, Notion, or Granola.
- A model fine-tuning system.

We should copy good implementation ideas from Hermes and Pi. Pi is especially relevant for clean TypeScript coding tools and TUI behavior. Hermes is especially relevant for memory, skills, session recall, delegation, and cron-style maintenance loops. The target product is still smaller and more opinionated: one user's local work context, maintained carefully.

## Design Commitments

- Local-first: the repo and `.strata/` runtime state are the system of record.
- Bun/TypeScript-first: all new first-party implementation should live in the current Bun workspace.
- Explicit tools: the agent acts through named, auditable tools, not hidden side effects.
- Shared agent runtime: CLI, TUI, and web chat should call the same agent loop and tool registry rather than implementing separate behavior.
- Shared connector contracts: CLI, TUI, scheduler, and web surfaces should call the same connector APIs.
- Safe writes: raw sources are immutable, broad writes are guarded, and risky changes should be staged for review.
- Durable traces: completed work should be inspectable and searchable later.
- Local-only control surfaces: any web UI should bind to loopback by default and treat connector credentials as secrets.
- Scheduled upkeep: the system should eventually run recurring maintenance jobs that keep the wiki, memory, skills, and indexes healthy.
- Progressive capability: start with narrow useful tools, then add more powerful tools once policy and observability are solid.
- Learning-first: memory, skills, and session recall should arrive early enough to shape the rest of the system.

## Near-Term Build Focus

The immediate build focus is the agentic harness, because the wiki cannot become self-maintaining until the harness has enough tool and learning infrastructure.

The next implementation sequence is:

1. Expand the tool foundation with registry profiles and safe filesystem read/search tools. Status: complete.
2. Add guarded edit/write tools for wiki maintenance. Status: complete.
3. Add a dangerous-mode shell tool for tests, formatting, and local automation. Status: complete.
4. Add todo, memory, session-search, and skill tools. Status: basic slice complete.
5. Inject active todos, memory, and a compact skill index into agent runs. Status: complete.
6. Wire reflection so learning artifacts improve after useful sessions. Status: basic slice complete.
7. Add scheduled maintenance jobs for wiki hygiene, memory review, skill curation, stale actions, and index refreshes.
8. Continue improving the TUI around the richer agent runtime.
9. Return to source ingestion and wiki automation once the harness can maintain the wiki with observable tools and learning loops. Status: Notion, Granola, and Slack raw snapshots now run through the shared connector runner; Slack also has initial checkpointed sync and Socket Mode tailing.
10. Add a browser chat interface over the shared agent runtime so agent sessions can be driven from `apps/web` while Slack ingestion and connector validation continue in the background. Status: planned.
11. After connector contracts and at least one raw-to-wiki ingestion path are stable, deepen the local web control plane for connector setup, dry-runs, schedules, ingest history, and proposal review. Status: initial skeleton present with connector list, Notion operations, Granola key setup, Slack status, and Notion MCP auth.

## Reference Implementations

Strata should selectively adapt features from Pi and Hermes rather than copying either product wholesale.

Pi features to adapt:

- File read, edit, write, grep, find, list, and shell tools.
- Tool result truncation and command-output ergonomics.
- TUI interaction patterns, especially transcript display, prompt editing, auth flow, session selection, and tool-call rendering.

Hermes features to adapt:

- Persistent memory and user profile storage.
- Skills as procedural memory.
- Session search across prior conversations.
- Reflection and curator loops.
- Cron-style scheduled maintenance.
- Eventually, scoped delegation and managed background processes.

Scheduled maintenance should be treated as a first-class product feature. The point is not just to answer questions on demand, but to keep the user's "brain" content fresh without requiring constant manual prompting.

## Plan Map

- [roadmap.md](./roadmap.md): canonical top-level intent and sequencing.
- [status.md](./status.md): current implementation status against the roadmap.
- [app-overview.md](./app-overview.md): concise orientation for agents joining the project.
- [wiki-plan.md](./wiki-plan.md): wiki structure, source ingestion, entity schemas, and maintenance workflows.
- [agent-harness-plan.md](./agent-harness-plan.md): model loop, tools, memory, skills, traces, and learning architecture.
- [tui-plan.md](./tui-plan.md): terminal UI architecture and implementation direction.
- [web-chat-plan.md](./web-chat-plan.md): local browser chat over the shared agent loop, using `packages/web-api` streaming endpoints and AI Elements UI components.
- [web-control-plane-plan.md](./web-control-plane-plan.md): local web UI for connector setup, operational status, scheduling, and proposal review.
- [slack-connector.md](./slack-connector.md): Slack backfill, checkpointing, Socket Mode, and app setup notes.

When the plans conflict, update this document first, then reconcile the lower-level plan.
