import { randomUUID } from "node:crypto";
import {
  type AgentAttachment,
  type AgentRunConfig,
  type AgentRunEvent,
  type AgentRunResult,
  type CreateModelAdapterOptions,
  createModelAdapter as createSharedModelAdapter,
  type ModelAdapter,
  type ModelProviderName,
  runAgentLoopEvents as runSharedAgentLoopEvents,
  type ThinkingLevel,
} from "@strata/agent";
import { getStrataPaths, type JsonObject, type JsonValue, SessionStore } from "@strata/core";
import {
  type ChatRunEventRecord,
  type ChatRunRecord,
  type ChatRunStatus,
  ChatRunStore,
  type FinishChatRunInput,
} from "./chatRunStore.js";

export interface StartChatRunInput {
  message: string;
  continueSessionId?: string;
  provider?: ModelProviderName;
  model?: string;
  reasoningEffort?: ThinkingLevel;
  attachments?: AgentAttachment[];
}

export type { ChatRunEvent } from "./chatEvents.js";

import type { ChatRunEvent } from "./chatEvents.js";

export interface ChatRunEventEnvelope {
  id: number;
  event: ChatRunEvent;
}

export interface StartedChatRun {
  runId: string;
  events: AsyncIterable<ChatRunEventEnvelope>;
}

export interface ActiveChatRunSnapshot {
  runId: string;
  startedAt: string;
  updatedAt?: string;
  endedAt?: string | null;
  status: ChatRunStatus;
  cancelled: boolean;
  lastEventId?: number;
  sessionId?: string;
  continueSessionId?: string;
  stoppedReason?: string;
  errorMessage?: string;
}

export interface ChatService {
  startRun(input: StartChatRunInput): Promise<StartedChatRun>;
  cancelRun(runId: string): Promise<boolean>;
  recordStreamClosed(runId: string, reason: ChatStreamCloseReason): Promise<boolean>;
  getActiveRun(runId: string): ActiveChatRunSnapshot | undefined;
  getRun(runId: string): ActiveChatRunSnapshot | undefined;
  getActiveRunForSession(sessionId: string): ActiveChatRunSnapshot | undefined;
  listActiveRuns(): ActiveChatRunSnapshot[];
  subscribeRunEvents(
    runId: string,
    afterEventId?: number,
  ): AsyncIterable<ChatRunEventEnvelope> | undefined;
}

export type ChatStreamCloseReason = "request_aborted" | "reader_cancelled";

type ModelAdapterFactory = (options: CreateModelAdapterOptions) => Promise<ModelAdapter>;
type AgentLoopEventsRunner = (config: AgentRunConfig) => AsyncGenerator<AgentRunEvent>;

export interface CreateChatServiceOptions {
  repoRoot?: string;
  env?: Record<string, string | undefined>;
  createModelAdapter?: ModelAdapterFactory;
  runAgentLoopEvents?: AgentLoopEventsRunner;
  createRunId?: () => string;
}

interface ActiveChatRun {
  runId: string;
  startedAt: string;
  controller: AbortController;
  events: ChatEventLog<ChatRunEventEnvelope>;
  sessionId?: string;
  continueSessionId?: string;
}

export class ChatRunConflictError extends Error {
  readonly runId: string;
  readonly sessionId: string;

  constructor(sessionId: string, runId: string) {
    super(`Session ${sessionId} already has an active chat run: ${runId}`);
    this.name = "ChatRunConflictError";
    this.sessionId = sessionId;
    this.runId = runId;
  }
}

export function createChatService(options: CreateChatServiceOptions = {}): ChatService {
  return new DefaultChatService(options);
}

class DefaultChatService implements ChatService {
  private readonly repoRoot: string;
  private readonly env: Record<string, string | undefined>;
  private readonly createModelAdapter: ModelAdapterFactory;
  private readonly runAgentLoopEvents: AgentLoopEventsRunner;
  private readonly createRunId: () => string;
  private readonly runStore: ChatRunStore;
  private readonly runsById = new Map<string, ActiveChatRun>();
  private readonly runIdsBySessionId = new Map<string, string>();

  constructor(options: CreateChatServiceOptions) {
    this.repoRoot = getStrataPaths(options.repoRoot).repoRoot;
    this.env = options.env ?? Bun.env;
    this.createModelAdapter = options.createModelAdapter ?? createSharedModelAdapter;
    this.runAgentLoopEvents = options.runAgentLoopEvents ?? runSharedAgentLoopEvents;
    this.createRunId = options.createRunId ?? randomUUID;
    this.runStore = new ChatRunStore(this.repoRoot);
    this.runStore.recoverAbandonedRuns();
  }

  async startRun(input: StartChatRunInput): Promise<StartedChatRun> {
    const message = input.message.trim();
    if (message === "") {
      throw new Error("Chat message is required.");
    }

    const runId = this.createUniqueRunId();
    if (input.continueSessionId !== undefined) {
      const existing = this.getActiveRunForSession(input.continueSessionId);
      if (existing !== undefined) {
        throw new ChatRunConflictError(input.continueSessionId, existing.runId);
      }
    }
    const persisted = this.runStore.createRun({
      runId,
      ...(input.continueSessionId === undefined
        ? {}
        : { continueSessionId: input.continueSessionId }),
    });
    const active: ActiveChatRun = {
      runId,
      startedAt: persisted.startedAt,
      controller: new AbortController(),
      events: new ChatEventLog<ChatRunEventEnvelope>(),
      ...(input.continueSessionId === undefined
        ? {}
        : { sessionId: input.continueSessionId, continueSessionId: input.continueSessionId }),
    };

    try {
      this.registerRun(active);
    } catch (error: unknown) {
      this.runStore.finishRun(runId, {
        status: "failed",
        stoppedReason: "registration_error",
        errorMessage: messageFromError(error),
      });
      throw error;
    }
    let model: ModelAdapter;
    try {
      model = await this.createModelAdapter(this.modelOptions(input));
    } catch (error: unknown) {
      this.runStore.finishRun(runId, {
        status: "failed",
        stoppedReason: "model_factory_error",
        errorMessage: messageFromError(error),
      });
      this.unregisterRun(active);
      throw error;
    }
    this.startRunEvents(active, input, model);

    return {
      runId,
      events: active.events.subscribe(),
    };
  }

  async cancelRun(runId: string): Promise<boolean> {
    const active = this.runsById.get(runId);
    if (active === undefined) {
      return false;
    }
    this.runStore.markCancelRequested(runId);
    active.controller.abort({ source: "web.cancel_endpoint", runId: active.runId });
    await this.recordRunEvent(active, "web.chat.run.cancel_requested", {
      runId: active.runId,
      source: "web.cancel_endpoint",
    });
    return true;
  }

  async recordStreamClosed(runId: string, reason: ChatStreamCloseReason): Promise<boolean> {
    const active = this.runsById.get(runId);
    if (active === undefined) {
      return false;
    }
    return this.recordRunEvent(active, "web.chat.stream.closed", {
      runId: active.runId,
      reason,
    });
  }

  getActiveRun(runId: string): ActiveChatRunSnapshot | undefined {
    const run = this.runStore.getRun(runId);
    return run?.status === "running" ? snapshot(run) : undefined;
  }

  getRun(runId: string): ActiveChatRunSnapshot | undefined {
    const run = this.runStore.getRun(runId);
    return run === undefined ? undefined : snapshot(run);
  }

  getActiveRunForSession(sessionId: string): ActiveChatRunSnapshot | undefined {
    const runId = this.runIdsBySessionId.get(sessionId);
    if (runId !== undefined) {
      return this.getActiveRun(runId);
    }
    const persisted = this.runStore.getRunningRunForSession(sessionId);
    return persisted === undefined ? undefined : snapshot(persisted);
  }

  listActiveRuns(): ActiveChatRunSnapshot[] {
    return this.runStore.listRuns("running").map(snapshot);
  }

  subscribeRunEvents(
    runId: string,
    afterEventId = 0,
  ): AsyncIterable<ChatRunEventEnvelope> | undefined {
    const run = this.runStore.getRun(runId);
    if (run === undefined) {
      return undefined;
    }
    const active = this.runsById.get(runId);
    if (active !== undefined) {
      return active.events.subscribe(afterEventId);
    }
    return iterableFromArray(this.storedEventEnvelopes(runId, afterEventId));
  }

  private startRunEvents(
    active: ActiveChatRun,
    input: StartChatRunInput,
    model: ModelAdapter,
  ): void {
    void this.runEvents(active, input, model);
  }

  private async runEvents(
    active: ActiveChatRun,
    input: StartChatRunInput,
    model: ModelAdapter,
  ): Promise<void> {
    let terminal: FinishChatRunInput | undefined;
    try {
      this.publishRunEvent(active, { type: "run.started", runId: active.runId });
      for await (const event of this.runAgentLoopEvents(
        this.agentRunConfig(active, input, model),
      )) {
        if (event.type === "session.started") {
          await this.bindSession(active, event.sessionId);
        }
        this.publishRunEvent(active, event);
        if (event.type === "agent.completed") {
          terminal = terminalFromResult(event.result);
        } else if (event.type === "agent.failed") {
          terminal = {
            status: "failed",
            stoppedReason: event.result?.stoppedReason ?? "agent_failed",
            errorMessage: event.message,
          };
        }
      }
    } catch (error: unknown) {
      const message = messageFromError(error);
      terminal = {
        status: "failed",
        stoppedReason: "chat_service_error",
        errorMessage: message,
      };
      this.publishRunEvent(active, { type: "agent.failed", message });
    } finally {
      const finish = terminal ?? {
        status: active.controller.signal.aborted ? "interrupted" : "failed",
        stoppedReason: active.controller.signal.aborted ? "cancelled" : "missing_terminal_event",
        cancelled: active.controller.signal.aborted,
      };
      await this.recordRunEvent(active, "web.chat.run.finished", {
        runId: active.runId,
        cancelled: active.controller.signal.aborted,
        status: finish.status,
      });
      this.runStore.finishRun(active.runId, finish);
      this.unregisterRun(active);
      active.events.close();
    }
  }

  private modelOptions(input: StartChatRunInput): CreateModelAdapterOptions {
    const options: CreateModelAdapterOptions = {
      repoRoot: this.repoRoot,
      env: this.env,
    };
    if (input.provider !== undefined) {
      options.provider = input.provider;
    }
    if (input.model !== undefined) {
      options.model = input.model;
    }
    return options;
  }

  private agentRunConfig(
    active: ActiveChatRun,
    input: StartChatRunInput,
    model: ModelAdapter,
  ): AgentRunConfig {
    const config: AgentRunConfig = {
      question: input.message,
      model,
      repoRoot: this.repoRoot,
      signal: active.controller.signal,
    };
    if (input.continueSessionId !== undefined) {
      config.continueSessionId = input.continueSessionId;
    }
    if (input.reasoningEffort !== undefined) {
      config.reasoningEffort = input.reasoningEffort;
    }
    if (input.attachments !== undefined && input.attachments.length > 0) {
      config.attachments = input.attachments;
    }
    return config;
  }

  private registerRun(active: ActiveChatRun): void {
    if (this.runsById.has(active.runId)) {
      throw new Error(`Chat run id collision: ${active.runId}`);
    }
    if (active.sessionId !== undefined) {
      const existingRunId =
        this.runIdsBySessionId.get(active.sessionId) ??
        this.runStore.getRunningRunForSession(active.sessionId)?.runId;
      if (existingRunId !== undefined) {
        throw new ChatRunConflictError(active.sessionId, existingRunId);
      }
      this.runIdsBySessionId.set(active.sessionId, active.runId);
    }
    this.runsById.set(active.runId, active);
  }

  private async bindSession(active: ActiveChatRun, sessionId: string): Promise<void> {
    const existingRunId =
      this.runIdsBySessionId.get(sessionId) ??
      this.runStore.getRunningRunForSession(sessionId)?.runId;
    if (existingRunId !== undefined && existingRunId !== active.runId) {
      active.controller.abort({
        source: "web.session_conflict",
        runId: active.runId,
        sessionId,
        existingRunId,
      });
      throw new ChatRunConflictError(sessionId, existingRunId);
    }
    if (active.sessionId !== undefined && active.sessionId !== sessionId) {
      const existingSessionRunId = this.runIdsBySessionId.get(active.sessionId);
      if (existingSessionRunId === active.runId) {
        this.runIdsBySessionId.delete(active.sessionId);
      }
    }
    active.sessionId = sessionId;
    this.runIdsBySessionId.set(sessionId, active.runId);
    this.runStore.bindSession(active.runId, sessionId);
    await this.recordRunEvent(active, "web.chat.run.started", {
      runId: active.runId,
      startedAt: active.startedAt,
      ...(active.continueSessionId === undefined
        ? {}
        : { continueSessionId: active.continueSessionId }),
    });
  }

  private unregisterRun(active: ActiveChatRun): void {
    const existing = this.runsById.get(active.runId);
    if (existing !== active) {
      return;
    }
    this.runsById.delete(active.runId);
    if (
      active.sessionId !== undefined &&
      this.runIdsBySessionId.get(active.sessionId) === active.runId
    ) {
      this.runIdsBySessionId.delete(active.sessionId);
    }
  }

  private createUniqueRunId(): string {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const runId = this.createRunId();
      if (!this.runsById.has(runId) && this.runStore.getRun(runId) === undefined) {
        return runId;
      }
    }
    throw new Error("Unable to allocate a unique chat run id.");
  }

  private publishRunEvent(active: ActiveChatRun, event: ChatRunEvent): void {
    const stored = this.runStore.appendEvent(
      active.runId,
      event.type,
      event as unknown as JsonValue,
    );
    active.events.publish({
      id: stored.id,
      event,
    });
  }

  private storedEventEnvelopes(runId: string, afterEventId: number): ChatRunEventEnvelope[] {
    const envelopes: ChatRunEventEnvelope[] = [];
    for (const record of this.runStore.listEvents(runId, afterEventId)) {
      const decoded = decodePersistedChatRunEvent(record);
      if (decoded !== null) {
        envelopes.push({ id: record.id, event: decoded });
      }
    }
    return envelopes;
  }

  private async recordRunEvent(
    active: ActiveChatRun,
    type: string,
    payload: JsonObject,
  ): Promise<boolean> {
    if (active.sessionId === undefined) {
      return false;
    }
    let store: SessionStore | undefined;
    try {
      store = await SessionStore.open(this.repoRoot);
      await store.appendEvent(active.sessionId, type, payload);
      return true;
    } catch {
      return false;
    } finally {
      store?.close();
    }
  }
}

function snapshot(run: ChatRunRecord): ActiveChatRunSnapshot {
  return {
    runId: run.runId,
    startedAt: run.startedAt,
    updatedAt: run.updatedAt,
    endedAt: run.endedAt,
    status: run.status,
    cancelled: run.cancelled,
    lastEventId: run.lastEventId,
    ...(run.sessionId === undefined ? {} : { sessionId: run.sessionId }),
    ...(run.continueSessionId === undefined ? {} : { continueSessionId: run.continueSessionId }),
    ...(run.stoppedReason === undefined ? {} : { stoppedReason: run.stoppedReason }),
    ...(run.errorMessage === undefined ? {} : { errorMessage: run.errorMessage }),
  };
}

interface ChatEventSubscriber {
  index: number;
  closed: boolean;
  wake?: () => void;
}

class ChatEventLog<T extends { id: number }> {
  private readonly history: T[] = [];
  private readonly subscribers = new Set<ChatEventSubscriber>();
  private closed = false;

  publish(event: T): void {
    if (this.closed) {
      return;
    }
    this.history.push(event);
    this.wakeSubscribers();
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.wakeSubscribers();
  }

  subscribe(afterEventId = 0): AsyncIterable<T> {
    const subscriber: ChatEventSubscriber = {
      index: this.history.findIndex((event) => event.id > afterEventId),
      closed: false,
    };
    if (subscriber.index === -1) {
      subscriber.index = this.history.length;
    }
    this.subscribers.add(subscriber);
    return {
      [Symbol.asyncIterator]: () => ({
        next: () => this.next(subscriber),
        return: () => this.return(subscriber),
      }),
    };
  }

  private wakeSubscribers(): void {
    for (const subscriber of this.subscribers) {
      const wake = subscriber.wake;
      if (wake !== undefined) {
        delete subscriber.wake;
        wake();
      }
    }
  }

  private next(subscriber: ChatEventSubscriber): Promise<IteratorResult<T>> {
    const immediate = this.takeNext(subscriber);
    if (immediate !== undefined) {
      return Promise.resolve(immediate);
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      subscriber.wake = () =>
        resolve(this.takeNext(subscriber) ?? { done: true, value: undefined });
    });
  }

  private return(subscriber: ChatEventSubscriber): Promise<IteratorResult<T>> {
    subscriber.closed = true;
    this.subscribers.delete(subscriber);
    if (subscriber.wake !== undefined) {
      const wake = subscriber.wake;
      delete subscriber.wake;
      wake();
    }
    return Promise.resolve({ done: true, value: undefined });
  }

  private takeNext(subscriber: ChatEventSubscriber): IteratorResult<T> | undefined {
    if (subscriber.closed) {
      return { done: true, value: undefined };
    }
    const event = this.history[subscriber.index];
    if (event !== undefined) {
      subscriber.index += 1;
      return { done: false, value: event };
    }
    if (this.closed) {
      subscriber.closed = true;
      this.subscribers.delete(subscriber);
      return { done: true, value: undefined };
    }
    return undefined;
  }
}

function terminalFromResult(result: AgentRunResult): FinishChatRunInput {
  return {
    status: result.status === "completed" ? "completed" : result.status,
    stoppedReason: result.stoppedReason,
    cancelled: result.stoppedReason === "cancelled",
  };
}

function iterableFromArray<T>(items: T[]): AsyncIterable<T> {
  return {
    async *[Symbol.asyncIterator]() {
      yield* items;
    },
  };
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const KNOWN_CHAT_RUN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "run.started",
  "session.started",
  "message.user",
  "model.request",
  "model.retry",
  "assistant.delta",
  "model.response",
  "tool.call.started",
  "tool.call.completed",
  "agent.completed",
  "agent.failed",
]);

/**
 * Narrow an untyped persisted `ChatRunEventRecord` back into a typed
 * `ChatRunEvent` for replay. Confirms the `type` discriminator matches a
 * known wire variant; payload shape beyond that is trusted because the
 * record was produced by `publishRunEvent` writing a typed event.
 *
 * Returns `null` for unknown discriminators (e.g. a record persisted by an
 * older agent loop variant); callers should drop those rather than crash.
 */
function decodePersistedChatRunEvent(record: ChatRunEventRecord): ChatRunEvent | null {
  const payload = record.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return null;
  }
  const typed = payload as { type?: unknown };
  if (typeof typed.type !== "string" || !KNOWN_CHAT_RUN_EVENT_TYPES.has(typed.type)) {
    return null;
  }
  return payload as unknown as ChatRunEvent;
}
