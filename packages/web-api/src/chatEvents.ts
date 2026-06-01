import type { AgentRunEvent } from "@strata/agent/types";

export type { AgentRunEvent };

/**
 * Wire-format event union sent over the SSE chat-run stream. Identical to
 * `AgentRunEvent` plus a single web-only `run.started` variant that the
 * web-api injects when a Web chat run is registered. The browser-side
 * subscriber consumes this exact union — there is no parallel hand-written
 * type. New variants live in `AgentRunEvent` (or here for web-only ones)
 * and reach every consumer through type inference.
 *
 * This file deliberately has *no* runtime imports so it stays type-only-
 * importable from the browser without dragging Bun-only modules into the
 * web app's TypeScript compilation.
 */
export type ChatRunEvent =
  | { type: "run.started"; runId: string }
  | { type: "run.replaced"; runId: string; previousRunId: string; sessionId: string }
  | AgentRunEvent;
