import type { QueryClient } from "@tanstack/react-query";
import {
  type ChatImageAttachment,
  type ChatStreamEvent,
  type ChatStreamEventMeta,
  cancelChatRun,
  forkChatSession,
  getChatRun,
  getChatSession,
  listActiveChatRuns,
  type SessionChangeNotice,
  type StartChatRunRequest,
  startChatRun,
  streamChatRunEvents,
  streamSessionChanges,
} from "@/lib/api";
import {
  agentCompletionMessage,
  appendPendingUserMessageFromEvent,
  appendUserMessageFromEvent,
  type ChatMessageView,
  type ChatRunState,
  type ChatSubmitInput,
  clientId,
  errorMessage,
  markPendingMessagesComplete,
  markPendingMessagesErrored,
  messagesToTranscript,
  sanitizeDisplayText,
  type TranscriptUpdate,
  toChatImageAttachment,
  transcriptUpdateForStreamEvent,
} from "@/lib/chatRunModel";
import {
  accumulateTokenUsage,
  createTokenUsageTotals,
  normalizeModelUsage,
  type TokenUsageTotals,
  usageTotalsFromMessages,
} from "@/lib/chatUsage";
import type { ChatModelChoice } from "@/lib/useChatModelChoice";

const MAX_STREAM_RECONNECTS = 2;
const CHAT_SESSION_PAGE_SIZE = 80;
/** Interval for discovering server-side runs not yet streamed by this client. */
const DISCOVER_INTERVAL_MS = 4_000;
const DISCONNECT_MESSAGE =
  "Live stream disconnected before the run finished. The server-side agent may still be running; use Stop to cancel it. The session list will refresh when it finishes.";

/**
 * Stable key for the not-yet-created "new chat" draft. A submit from this slot
 * migrates to the assigned session id once `session.started` arrives.
 */
export const NEW_CHAT_KEY = "__new__";

/** Immutable, React-facing per-session run state. */
export interface SessionRunState {
  runKey: string;
  sessionId: string | null;
  sessionTitle: string | null;
  sessionModel: string | null;
  transcript: ChatMessageView[];
  runState: ChatRunState;
  activeRunId: string | null;
  activeRunStartedAt: string | null;
  error: string | null;
  usageTotals: TokenUsageTotals;
  /** True once the persisted transcript has been seeded for this view. */
  loaded: boolean;
  hasMoreBefore: boolean;
  oldestDisplayMessageId: number | null;
  olderMessagesLoading: boolean;
  /**
   * The session has a run active server-side that this tab is *not* streaming
   * itself (e.g. advanced by the CLI/TUI, or a non-web run). Distinct from
   * `runState`, which only reflects a stream this tab owns; kept separate so it
   * never races the discovery reconciler.
   */
  externallyRunning: boolean;
}

/** Mutable streaming bookkeeping; never read during render. */
interface RunRefs {
  abort: AbortController | null;
  runId: string | null;
  lastEventId: number;
  reconnectAttempts: number;
  runTerminal: boolean;
  replacingRun: boolean;
}

/** Indirection so a stream started under the draft key follows its migration. */
interface KeyRef {
  current: string;
}

type Navigate = (sessionId: string | null, options?: { replace?: boolean }) => void;

const noopNavigate: Navigate = () => {};

function isLiveRunState(state: ChatRunState): boolean {
  return (
    state === "starting" ||
    state === "streaming" ||
    state === "cancelling" ||
    state === "disconnected"
  );
}

function blankState(key: string): SessionRunState {
  return {
    runKey: key,
    sessionId: key === NEW_CHAT_KEY ? null : key,
    sessionTitle: null,
    sessionModel: null,
    transcript: [],
    runState: "idle",
    activeRunId: null,
    activeRunStartedAt: null,
    error: null,
    usageTotals: createTokenUsageTotals(),
    loaded: false,
    hasMoreBefore: false,
    oldestDisplayMessageId: null,
    olderMessagesLoading: false,
    externallyRunning: false,
  };
}

interface PendingTranscriptBatch {
  updaters: TranscriptUpdate[];
  patch: Partial<SessionRunState>;
}

/**
 * Owns every chat run the browser is tracking, keyed by session (with a single
 * `NEW_CHAT_KEY` draft slot for not-yet-created chats). The store outlives any
 * view, so runs started in one session keep streaming while the user looks at
 * another — switching sessions is a pure read of an already-live buffer.
 *
 * React reads slices through `useSyncExternalStore`: per-key snapshots are
 * immutable objects replaced on change, so a component viewing session A does
 * not re-render when session B streams a token.
 */
class ChatRunsStore {
  private states = new Map<string, SessionRunState>();
  private refs = new Map<string, RunRefs>();
  private listeners = new Set<() => void>();
  private queryClient: QueryClient | null = null;
  private discoverTimer: ReturnType<typeof setInterval> | null = null;
  private discovering = false;
  private changeFeedStarted = false;
  private pendingTranscriptBatches = new Map<string, PendingTranscriptBatch>();
  private transcriptFlushHandle: number | ReturnType<typeof setTimeout> | null = null;
  private sessionTranscriptLoads = new Map<string, Promise<void>>();

  // Cached so the running-set selector keeps a stable identity between renders.
  private runningSnapshot: ReadonlySet<string> = new Set();
  private queueRefreshVersion = 0;

  setQueryClient(client: QueryClient): void {
    this.queryClient = client;
  }

  renameSession(sessionId: string, title: string): void {
    this.update(sessionId, { sessionTitle: sanitizeDisplayText(title) });
    this.refreshSessions();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.ensureDiscovering();
    this.ensureChangeFeed();
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = (key: string): SessionRunState | undefined => this.states.get(key);

  getRunningSessionIds = (): ReadonlySet<string> => this.runningSnapshot;

  getQueueRefreshVersion = (): number => this.queueRefreshVersion;

  // --- React notification --------------------------------------------------
  private emit(): void {
    this.recomputeRunning();
    for (const listener of this.listeners) {
      listener();
    }
  }

  private recomputeRunning(): void {
    const next = new Set<string>();
    for (const state of this.states.values()) {
      if (state.sessionId !== null && isLiveRunState(state.runState)) {
        next.add(state.sessionId);
      }
    }
    if (
      next.size !== this.runningSnapshot.size ||
      [...next].some((id) => !this.runningSnapshot.has(id))
    ) {
      this.runningSnapshot = next;
    }
  }

  private update(key: string, patch: Partial<SessionRunState>): void {
    const base = this.states.get(key) ?? blankState(key);
    this.states.set(key, { ...base, ...patch });
    this.emit();
  }

  private updateTranscript(
    key: string,
    updater: (transcript: ChatMessageView[]) => ChatMessageView[],
  ): void {
    this.flushPendingTranscript(key);
    const base = this.states.get(key) ?? blankState(key);
    this.update(key, { transcript: updater(base.transcript) });
  }

  private queueTranscriptUpdate(
    key: string,
    updater: TranscriptUpdate,
    patch: Partial<SessionRunState> = {},
  ): void {
    const batch = this.pendingTranscriptBatches.get(key) ?? { updaters: [], patch: {} };
    batch.updaters.push(updater);
    batch.patch = { ...batch.patch, ...patch };
    this.pendingTranscriptBatches.set(key, batch);
    this.scheduleTranscriptFlush();
  }

  private scheduleTranscriptFlush(): void {
    if (this.transcriptFlushHandle !== null) {
      return;
    }
    if (typeof globalThis.requestAnimationFrame === "function") {
      this.transcriptFlushHandle = globalThis.requestAnimationFrame(() => {
        this.transcriptFlushHandle = null;
        this.flushPendingTranscripts();
      });
      return;
    }
    this.transcriptFlushHandle = globalThis.setTimeout(() => {
      this.transcriptFlushHandle = null;
      this.flushPendingTranscripts();
    }, 16);
  }

  private flushPendingTranscripts(): void {
    if (this.pendingTranscriptBatches.size === 0) {
      return;
    }
    const batches = this.pendingTranscriptBatches;
    this.pendingTranscriptBatches = new Map();
    for (const [key, batch] of batches) {
      const base = this.states.get(key) ?? blankState(key);
      const transcript = batch.updaters.reduce(
        (current, updater) => updater(current),
        base.transcript,
      );
      this.states.set(key, { ...base, ...batch.patch, transcript });
    }
    this.emit();
  }

  private flushPendingTranscript(key: string): void {
    const batch = this.pendingTranscriptBatches.get(key);
    if (batch === undefined) {
      return;
    }
    this.pendingTranscriptBatches.delete(key);
    const base = this.states.get(key) ?? blankState(key);
    const transcript = batch.updaters.reduce(
      (current, updater) => updater(current),
      base.transcript,
    );
    this.states.set(key, { ...base, ...batch.patch, transcript });
    this.emit();
  }

  private streamingPatch(key: string): Partial<SessionRunState> {
    return this.states.get(key)?.runState === "streaming" ? {} : { runState: "streaming" };
  }

  private refsFor(key: string): RunRefs {
    let refs = this.refs.get(key);
    if (refs === undefined) {
      refs = {
        abort: null,
        runId: null,
        lastEventId: 0,
        reconnectAttempts: 0,
        runTerminal: false,
        replacingRun: false,
      };
      this.refs.set(key, refs);
    }
    return refs;
  }

  private refreshSessions(): void {
    void this.queryClient?.invalidateQueries({ queryKey: ["chat", "sessions"] });
  }

  // --- View wiring ---------------------------------------------------------

  /** Ensure a draft slot exists for the "new chat" view. */
  ensureDraft(): void {
    if (!this.states.has(NEW_CHAT_KEY)) {
      this.states.set(NEW_CHAT_KEY, { ...blankState(NEW_CHAT_KEY), loaded: true });
      this.emit();
    }
  }

  /**
   * Make sure the viewed session's transcript is present. No-op when the store
   * already holds live or loaded state for it (so returning to a
   * background-streaming session shows its live buffer with no reload flicker).
   */
  ensureSessionLoaded(sessionId: string): void {
    const existing = this.states.get(sessionId);
    if (existing !== undefined && (existing.loaded || isLiveRunState(existing.runState))) {
      return;
    }
    void this.seedSessionTranscript(sessionId);
  }

  /**
   * Fetch and seed a session's persisted transcript. Awaitable so background
   * run attachment can seed *before* it marks the session streaming — otherwise
   * the live-state guard below would skip seeding and leave a recovered run with
   * an empty transcript. Returns early when already loaded or when a live stream
   * is in progress (don't clobber an in-flight run's buffer).
   */
  private seedSessionTranscript(sessionId: string): Promise<void> {
    const pending = this.sessionTranscriptLoads.get(sessionId);
    if (pending !== undefined) {
      return pending;
    }
    const load = this.loadSessionTranscript(sessionId);
    this.sessionTranscriptLoads.set(sessionId, load);
    void load.finally(() => {
      if (this.sessionTranscriptLoads.get(sessionId) === load) {
        this.sessionTranscriptLoads.delete(sessionId);
      }
    });
    return load;
  }

  private async loadSessionTranscript(sessionId: string): Promise<void> {
    const existing = this.states.get(sessionId);
    if (existing !== undefined && existing.loaded) {
      return;
    }
    // Seed a placeholder so the selector has a stable object while loading.
    if (existing === undefined) {
      this.states.set(sessionId, blankState(sessionId));
      this.emit();
    }
    try {
      const detail = await getChatSession(sessionId, { messageLimit: CHAT_SESSION_PAGE_SIZE });
      if (detail === null) {
        this.update(sessionId, { error: `Session not found: ${sessionId}`, loaded: true });
        return;
      }
      // Don't clobber a stream that started while the fetch was in flight.
      const current = this.states.get(sessionId);
      if (current !== undefined && isLiveRunState(current.runState)) {
        return;
      }
      const alignment = current?.transcript;
      const stored = messagesToTranscript(detail.messages, alignment);
      const transcript =
        detail.session.status === "failed" || detail.session.status === "interrupted"
          ? markPendingMessagesErrored(stored)
          : detail.session.status === "completed"
            ? markPendingMessagesComplete(stored)
            : stored;
      this.update(sessionId, {
        sessionId: detail.session.id,
        sessionTitle: sanitizeDisplayText(detail.session.title),
        sessionModel: detail.session.model,
        transcript,
        usageTotals: usageTotalsFromMessages(detail.messages),
        loaded: true,
        hasMoreBefore: detail.messagePage.hasMoreBefore,
        oldestDisplayMessageId: detail.messagePage.oldestDisplayMessageId,
        olderMessagesLoading: false,
        externallyRunning:
          detail.session.status === "running" && this.refs.get(sessionId)?.abort == null,
        error:
          detail.session.status === "failed" || detail.session.status === "interrupted"
            ? agentCompletionMessage(detail.session.status)
            : null,
      });
    } catch (cause: unknown) {
      this.update(sessionId, { error: errorMessage(cause), loaded: true });
    }
  }

  setError(key: string, message: string | null): void {
    this.update(key, { error: message });
  }

  loadOlder(key: string): void {
    const state = this.states.get(key);
    if (
      state === undefined ||
      state.sessionId === null ||
      state.olderMessagesLoading ||
      !state.hasMoreBefore ||
      state.oldestDisplayMessageId === null
    ) {
      return;
    }
    const { sessionId, oldestDisplayMessageId } = state;
    this.update(key, { olderMessagesLoading: true, error: null });
    void getChatSession(sessionId, {
      messageLimit: CHAT_SESSION_PAGE_SIZE,
      beforeMessageId: oldestDisplayMessageId,
    }).then(
      (detail) => {
        if (detail === null) {
          this.update(key, {
            error: `Session not found: ${sessionId}`,
            olderMessagesLoading: false,
          });
          return;
        }
        const current = this.states.get(key) ?? blankState(key);
        const olderTranscript = messagesToTranscript(detail.messages);
        const nextOldest =
          detail.messagePage.oldestDisplayMessageId ?? current.oldestDisplayMessageId;
        this.update(key, {
          transcript: [...olderTranscript, ...current.transcript],
          hasMoreBefore: detail.messagePage.hasMoreBefore,
          oldestDisplayMessageId: nextOldest,
          olderMessagesLoading: false,
        });
      },
      (cause: unknown) => {
        this.update(key, { error: errorMessage(cause), olderMessagesLoading: false });
      },
    );
  }

  // --- Submit --------------------------------------------------------------

  submit(args: {
    viewKey: string;
    input: ChatSubmitInput;
    modelChoice: ChatModelChoice | null;
    navigate: Navigate;
  }): void {
    const { viewKey, input, modelChoice, navigate } = args;
    const message = input.message.trim();
    const hasAttachments = input.attachments.length > 0;
    if (message === "" && !hasAttachments) {
      return;
    }
    const state = this.states.get(viewKey);
    if (state !== undefined && (state.runState !== "idle" || state.externallyRunning)) {
      return;
    }

    const continuingSessionId = viewKey === NEW_CHAT_KEY ? null : (state?.sessionId ?? viewKey);

    const controller = new AbortController();
    const refs = this.refsFor(viewKey);
    refs.abort = controller;
    refs.runId = null;
    refs.lastEventId = 0;
    refs.reconnectAttempts = 0;
    refs.runTerminal = false;
    refs.replacingRun = false;
    const keyRef: KeyRef = { current: viewKey };

    const sentAttachments = input.attachments;
    this.update(viewKey, {
      runState: "starting",
      activeRunStartedAt: new Date().toISOString(),
      error: null,
      loaded: true,
      externallyRunning: false,
      ...(continuingSessionId === null ? { usageTotals: createTokenUsageTotals() } : {}),
    });
    this.updateTranscript(viewKey, (current) => [
      ...current,
      {
        id: clientId("user"),
        role: "user",
        content: message,
        status: "complete",
        toolCalls: [],
        attachments: sentAttachments,
      },
    ]);

    const request: StartChatRunRequest = {
      message: message === "" ? "(image attached)" : message,
    };
    if (continuingSessionId !== null) {
      request.continueSessionId = continuingSessionId;
    }
    if (sentAttachments.length > 0) {
      request.attachments = sentAttachments
        .map(toChatImageAttachment)
        .filter((value): value is ChatImageAttachment => value !== null);
    }
    if (modelChoice !== null) {
      request.provider = modelChoice.provider;
      request.model = modelChoice.model;
      request.reasoningEffort = modelChoice.reasoningEffort;
    }

    startChatRun(
      request,
      (event, meta) => this.applyStreamEvent(keyRef, refs, event, meta, navigate),
      controller.signal,
    ).then(
      () => this.onStreamSettled(keyRef, refs, controller, navigate, null),
      (cause: unknown) => this.onStreamSettled(keyRef, refs, controller, navigate, cause),
    );
  }

  // --- Stream lifecycle ----------------------------------------------------

  private onStreamSettled(
    keyRef: KeyRef,
    refs: RunRefs,
    controller: AbortController,
    navigate: Navigate,
    cause: unknown | null,
  ): void {
    const key = keyRef.current;
    const streamDisconnected =
      !controller.signal.aborted && refs.runId !== null && !refs.runTerminal;
    if (refs.replacingRun) {
      refs.abort = null;
      refs.runId = null;
      refs.runTerminal = true;
      refs.replacingRun = false;
      return;
    }
    if (refs.abort === controller) {
      if (refs.runTerminal || controller.signal.aborted) {
        this.update(key, { runState: "idle", activeRunId: null, activeRunStartedAt: null });
        refs.runId = null;
      } else if (streamDisconnected) {
        const runId = refs.runId;
        if (runId !== null && this.resumeStream(keyRef, refs, runId, controller, navigate)) {
          return;
        }
        this.update(key, { runState: "disconnected", error: DISCONNECT_MESSAGE });
      } else {
        this.update(key, { runState: "idle", activeRunId: null, activeRunStartedAt: null });
        refs.runId = null;
      }
      refs.abort = null;
    }
    if (cause !== null && !controller.signal.aborted && !streamDisconnected) {
      this.update(key, { error: errorMessage(cause) });
      this.updateTranscript(key, markPendingMessagesErrored);
    }
    this.refreshSessions();
  }

  private resumeStream(
    keyRef: KeyRef,
    refs: RunRefs,
    runId: string,
    controller: AbortController,
    navigate: Navigate,
  ): boolean {
    if (refs.reconnectAttempts >= MAX_STREAM_RECONNECTS) {
      return false;
    }
    refs.reconnectAttempts += 1;
    this.update(keyRef.current, { runState: "streaming", error: null });
    streamChatRunEvents(
      runId,
      refs.lastEventId,
      (event, meta) => this.applyStreamEvent(keyRef, refs, event, meta, navigate),
      controller.signal,
    ).then(
      () => {
        if (refs.abort !== controller) {
          return;
        }
        if (refs.runTerminal || controller.signal.aborted) {
          this.update(keyRef.current, {
            runState: "idle",
            activeRunId: null,
            activeRunStartedAt: null,
          });
          refs.runId = null;
          refs.abort = null;
          this.refreshSessions();
          return;
        }
        if (!this.resumeStream(keyRef, refs, runId, controller, navigate)) {
          this.update(keyRef.current, { runState: "disconnected", error: DISCONNECT_MESSAGE });
          this.refreshSessions();
        }
      },
      (cause: unknown) => {
        if (refs.abort !== controller || controller.signal.aborted) {
          return;
        }
        if (!this.resumeStream(keyRef, refs, runId, controller, navigate)) {
          this.update(keyRef.current, { runState: "disconnected", error: errorMessage(cause) });
          this.refreshSessions();
        }
      },
    );
    return true;
  }

  private applyStreamEvent(
    keyRef: KeyRef,
    refs: RunRefs,
    event: ChatStreamEvent,
    meta: ChatStreamEventMeta = { id: null },
    navigate: Navigate,
  ): void {
    if (meta.id !== null && meta.id > refs.lastEventId) {
      refs.lastEventId = meta.id;
    }
    const key = keyRef.current;
    switch (event.type) {
      case "run.started":
        refs.runId = event.runId;
        refs.runTerminal = false;
        refs.replacingRun = false;
        this.update(key, {
          activeRunId: event.runId,
          activeRunStartedAt: this.states.get(key)?.activeRunStartedAt ?? new Date().toISOString(),
          runState: "streaming",
        });
        break;
      case "run.replaced":
        refs.replacingRun = true;
        refs.runTerminal = true;
        this.attachReplacementRun(key, event.runId, event.sessionId);
        break;
      case "session.started": {
        const target = this.migrateToSession(keyRef, event.sessionId);
        this.update(target, {
          sessionId: event.sessionId,
          sessionTitle: sanitizeDisplayText(event.title),
          sessionModel: event.model,
        });
        navigate(event.sessionId, { replace: true });
        // Surface the new session in the sidebar/cmd-k right away so its live
        // running indicator can show before the run finishes.
        this.refreshSessions();
        break;
      }
      case "message.user.pending":
        this.updateTranscript(key, (current) => appendPendingUserMessageFromEvent(current, event));
        break;
      case "message.user":
        this.updateTranscript(key, (current) =>
          appendUserMessageFromEvent(current, event, { dedupeLast: true }),
        );
        break;
      case "model.request":
      case "model.retry":
        if (this.states.get(key)?.runState !== "streaming") {
          this.update(key, { runState: "streaming" });
        }
        break;
      case "assistant.delta":
      case "assistant.reasoning": {
        this.queueTranscriptUpdate(
          key,
          transcriptUpdateForStreamEvent(event, refs.runId),
          this.streamingPatch(key),
        );
        break;
      }
      case "model.response": {
        this.flushPendingTranscript(key);
        const turnUsage = event.usage === undefined ? undefined : normalizeModelUsage(event.usage);
        const base = this.states.get(key) ?? blankState(key);
        this.update(key, {
          usageTotals: accumulateTokenUsage(base.usageTotals, event.usage),
          transcript: transcriptUpdateForStreamEvent(event, refs.runId, turnUsage)(base.transcript),
        });
        break;
      }
      case "compaction.started":
        if (this.states.get(key)?.runState !== "streaming") {
          this.update(key, { runState: "streaming" });
        }
        break;
      case "compaction.completed":
        this.update(key, { usageTotals: createTokenUsageTotals() });
        break;
      case "compaction.failed":
        this.update(key, { error: event.message });
        break;
      case "tool.call.started":
        this.queueTranscriptUpdate(key, transcriptUpdateForStreamEvent(event, refs.runId));
        break;
      case "tool.output":
        this.queueTranscriptUpdate(key, transcriptUpdateForStreamEvent(event, refs.runId));
        break;
      case "tool.call.completed":
        this.queueTranscriptUpdate(key, transcriptUpdateForStreamEvent(event, refs.runId));
        break;
      case "agent.completed": {
        this.flushPendingTranscript(key);
        refs.runTerminal = true;
        refs.runId = null;
        refs.replacingRun = false;
        const sessionId = event.result.sessionId !== "" ? event.result.sessionId : undefined;
        const message =
          event.result.status === "completed"
            ? null
            : agentCompletionMessage(event.result.status, event.result.stoppedReason);
        this.update(key, {
          runState: "idle",
          activeRunId: null,
          activeRunStartedAt: null,
          ...(sessionId === undefined ? {} : { sessionId }),
          ...(message === null ? {} : { error: message }),
        });
        if (event.result.status !== "completed") {
          this.updateTranscript(
            key,
            message === null ? markPendingMessagesComplete : markPendingMessagesErrored,
          );
        }
        break;
      }
      case "agent.failed":
        this.flushPendingTranscript(key);
        refs.runTerminal = true;
        refs.runId = null;
        refs.replacingRun = false;
        this.update(key, {
          runState: "idle",
          activeRunId: null,
          activeRunStartedAt: null,
          error: event.message,
        });
        this.updateTranscript(key, markPendingMessagesErrored);
        break;
    }
  }

  private attachReplacementRun(key: string, runId: string, sessionId: string): void {
    const refs = this.refsFor(key);
    const controller = new AbortController();
    refs.abort = controller;
    refs.runId = runId;
    refs.lastEventId = 0;
    refs.reconnectAttempts = 0;
    refs.runTerminal = false;
    refs.replacingRun = false;
    const keyRef: KeyRef = { current: key };
    this.update(key, {
      runState: "streaming",
      activeRunId: runId,
      activeRunStartedAt: new Date().toISOString(),
      externallyRunning: false,
      ...(this.states.get(key)?.sessionId === null ? { sessionId } : {}),
    });
    if (!this.resumeStream(keyRef, refs, runId, controller, noopNavigate)) {
      refs.abort = null;
      this.update(key, { runState: "disconnected", error: DISCONNECT_MESSAGE });
    }
  }

  /** Move draft state+refs onto the assigned session key. Returns the new key. */
  private migrateToSession(keyRef: KeyRef, sessionId: string): string {
    const fromKey = keyRef.current;
    if (fromKey === sessionId) {
      return sessionId;
    }
    const state = this.states.get(fromKey);
    if (state !== undefined) {
      this.states.set(sessionId, { ...state, runKey: sessionId, sessionId });
      // Reset the draft slot so the next new chat starts clean.
      this.states.set(fromKey, { ...blankState(fromKey), loaded: true });
    }
    const refs = this.refs.get(fromKey);
    if (refs !== undefined) {
      this.refs.set(sessionId, refs);
      this.refs.delete(fromKey);
    }
    keyRef.current = sessionId;
    this.emit();
    return sessionId;
  }

  // --- Cancel / clear / fork ----------------------------------------------

  cancel(key: string): void {
    const state = this.states.get(key);
    if (state === undefined || state.runState === "idle") {
      return;
    }
    const refs = this.refs.get(key);
    const runId = refs?.runId ?? state.activeRunId;
    this.update(key, { runState: "cancelling" });

    const finish = () => {
      refs?.abort?.abort();
      if (refs !== undefined) {
        refs.abort = null;
        refs.runTerminal = true;
        refs.runId = null;
        refs.replacingRun = false;
      }
      this.update(key, { runState: "idle", activeRunId: null, activeRunStartedAt: null });
      this.updateTranscript(key, markPendingMessagesComplete);
      this.refreshSessions();
    };

    if (runId === null || runId === undefined) {
      finish();
      return;
    }
    cancelChatRun(runId).then(finish, (cause: unknown) => {
      this.update(key, { error: errorMessage(cause) });
      finish();
    });
  }

  clearDraft(navigate: Navigate): void {
    this.states.set(NEW_CHAT_KEY, { ...blankState(NEW_CHAT_KEY), loaded: true });
    this.emit();
    navigate(null);
  }

  fork(key: string, navigate: Navigate): void {
    const state = this.states.get(key);
    if (state === undefined) {
      return;
    }
    if (state.runState !== "idle") {
      this.update(key, { error: "Cannot fork while a run is active." });
      return;
    }
    if (state.sessionId === null) {
      this.update(key, { error: "No active session to fork." });
      return;
    }
    void forkChatSession(state.sessionId).then(
      (detail) => {
        this.states.set(detail.session.id, {
          ...blankState(detail.session.id),
          sessionTitle: sanitizeDisplayText(detail.session.title),
          sessionModel: detail.session.model,
          transcript: messagesToTranscript(detail.messages),
          usageTotals: usageTotalsFromMessages(detail.messages),
          loaded: true,
          hasMoreBefore: detail.messagePage.hasMoreBefore,
          oldestDisplayMessageId: detail.messagePage.oldestDisplayMessageId,
          olderMessagesLoading: false,
        });
        this.emit();
        navigate(detail.session.id);
        this.refreshSessions();
      },
      (cause: unknown) => {
        this.update(key, { error: errorMessage(cause) });
      },
    );
  }

  // --- Local realtime change feed -----------------------------------------

  /**
   * Subscribe to the server's `/api/changes` feed once. Notices arrive whenever
   * any process advances a session (this tab, another tab, or the CLI/TUI), so
   * the UI reflects external progress live. Reconnects on drop.
   */
  private ensureChangeFeed(): void {
    if (this.changeFeedStarted) {
      return;
    }
    this.changeFeedStarted = true;
    const connect = (): void => {
      const controller = new AbortController();
      streamSessionChanges((notice) => this.handleExternalChanges(notice), controller.signal).then(
        () => {
          // Stream ended cleanly; reconnect after a short delay.
          setTimeout(connect, 1_000);
        },
        () => {
          setTimeout(connect, 2_000);
        },
      );
    };
    connect();
  }

  private handleExternalChanges(notice: SessionChangeNotice): void {
    // Refresh the sidebar / cmd-k session list (new sessions, status flips).
    void this.queryClient?.invalidateQueries({ queryKey: ["chat", "sessions"] });
    // Attach instantly to any newly-started web run (instead of waiting for the
    // discovery poll); deduped by the `discovering` guard.
    void this.discoverActiveRuns();
    if (notice.queue !== undefined) {
      this.queueRefreshVersion += 1;
      this.emit();
    }
    // Refresh transcripts for sessions we're showing that this tab isn't itself
    // streaming (CLI/TUI-driven runs, or runs owned by another tab).
    for (const sessionId of notice.sessionIds) {
      if (this.states.has(sessionId) && this.refs.get(sessionId)?.abort == null) {
        void this.reloadSession(sessionId);
      }
    }
  }

  /**
   * Re-fetch a session's persisted transcript after an external change. Skips
   * sessions this tab is actively streaming (their live buffer is authoritative)
   * and never changes `runState`, so it can't race the discovery reconciler.
   */
  private async reloadSession(sessionId: string): Promise<void> {
    if (this.refs.get(sessionId)?.abort != null) {
      return;
    }
    const existing = this.states.get(sessionId);
    if (existing === undefined) {
      return;
    }
    try {
      const detail = await getChatSession(sessionId, { messageLimit: CHAT_SESSION_PAGE_SIZE });
      if (detail === null) {
        return;
      }
      // A live stream may have started while the fetch was in flight.
      if (this.refs.get(sessionId)?.abort != null) {
        return;
      }
      const current = this.states.get(sessionId);
      const stored = messagesToTranscript(detail.messages, current?.transcript);
      const transcript =
        detail.session.status === "failed" || detail.session.status === "interrupted"
          ? markPendingMessagesErrored(stored)
          : detail.session.status === "completed"
            ? markPendingMessagesComplete(stored)
            : stored;
      this.update(sessionId, {
        sessionId: detail.session.id,
        sessionTitle: sanitizeDisplayText(detail.session.title),
        sessionModel: detail.session.model,
        transcript,
        usageTotals: usageTotalsFromMessages(detail.messages),
        loaded: true,
        hasMoreBefore: detail.messagePage.hasMoreBefore,
        oldestDisplayMessageId: detail.messagePage.oldestDisplayMessageId,
        olderMessagesLoading: false,
        externallyRunning:
          detail.session.status === "running" && this.refs.get(sessionId)?.abort == null,
      });
    } catch {
      // Transient; the next change notice retries.
    }
  }

  // --- Background discovery (cross-tab / reload recovery) ------------------

  private ensureDiscovering(): void {
    if (this.discoverTimer !== null) {
      return;
    }
    void this.discoverActiveRuns();
    this.discoverTimer = setInterval(() => {
      void this.discoverActiveRuns();
    }, DISCOVER_INTERVAL_MS);
  }

  private async discoverActiveRuns(): Promise<void> {
    if (this.discovering) {
      return;
    }
    this.discovering = true;
    try {
      const runs = await listActiveChatRuns();
      const activeSessionIds = new Set<string>();
      for (const run of runs) {
        const sessionId = run.sessionId ?? run.continueSessionId;
        if (sessionId === undefined || sessionId === null) {
          continue;
        }
        activeSessionIds.add(sessionId);
        const refs = this.refs.get(sessionId);
        if (refs !== undefined && refs.abort !== null) {
          continue; // already streaming this run in this tab
        }
        void this.attachBackgroundRun(sessionId, run.runId, run.lastEventId ?? 0, run.startedAt);
      }
      // A session we believe is streaming but the server no longer lists as
      // running has finished elsewhere — reconcile its transcript.
      for (const [key, state] of this.states) {
        if (key === NEW_CHAT_KEY || state.sessionId === null) {
          continue;
        }
        const refs = this.refs.get(key);
        const clientStreaming = refs?.abort !== null && refs?.abort !== undefined;
        if (state.runState === "disconnected" && !activeSessionIds.has(state.sessionId)) {
          this.reconcileFinishedRun(state.sessionId, state.activeRunId);
        } else if (
          !clientStreaming &&
          isLiveRunState(state.runState) &&
          !activeSessionIds.has(state.sessionId)
        ) {
          this.reconcileFinishedRun(state.sessionId, state.activeRunId);
        }
      }
    } catch {
      // Network blip; the next tick retries.
    } finally {
      this.discovering = false;
    }
  }

  private async attachBackgroundRun(
    sessionId: string,
    runId: string,
    lastEventId: number,
    startedAt: string,
  ): Promise<void> {
    // Bail if a stream is already attached for this session (the view started
    // one, or a previous discovery tick already attached).
    if (this.refs.get(sessionId)?.abort != null) {
      return;
    }
    // Seed the persisted transcript first and await it, so the live-state guard
    // in seeding doesn't skip it once we mark the run streaming below. Without
    // this, a background-recovered run renders an empty transcript.
    await this.seedSessionTranscript(sessionId);
    // Re-check after awaiting: the view may have attached its own stream.
    if (this.refs.get(sessionId)?.abort != null) {
      return;
    }
    const controller = new AbortController();
    const refs = this.refsFor(sessionId);
    refs.abort = controller;
    refs.runId = runId;
    refs.lastEventId = lastEventId;
    refs.reconnectAttempts = 0;
    refs.runTerminal = false;
    refs.replacingRun = false;
    const keyRef: KeyRef = { current: sessionId };
    this.update(sessionId, {
      runState: "streaming",
      activeRunId: runId,
      activeRunStartedAt: this.states.get(sessionId)?.activeRunStartedAt ?? startedAt,
      externallyRunning: false,
    });
    if (!this.resumeStream(keyRef, refs, runId, controller, noopNavigate)) {
      refs.abort = null;
      this.update(sessionId, { runState: "disconnected", error: DISCONNECT_MESSAGE });
    }
  }

  private reconcileFinishedRun(sessionId: string, runId: string | null): void {
    const finalize = (status: string | undefined, stoppedReason: string | undefined) => {
      void getChatSession(sessionId, { messageLimit: CHAT_SESSION_PAGE_SIZE }).then((detail) => {
        if (detail !== null) {
          this.update(sessionId, {
            transcript: messagesToTranscript(
              detail.messages,
              this.states.get(sessionId)?.transcript,
            ),
            usageTotals: usageTotalsFromMessages(detail.messages),
            hasMoreBefore: detail.messagePage.hasMoreBefore,
            oldestDisplayMessageId: detail.messagePage.oldestDisplayMessageId,
            olderMessagesLoading: false,
          });
        }
        const resolved = status ?? detail?.session.status ?? "unknown";
        const message =
          resolved === "completed" ? null : agentCompletionMessage(resolved, stoppedReason);
        this.update(sessionId, {
          runState: "idle",
          activeRunId: null,
          activeRunStartedAt: null,
          error: message,
        });
        if (resolved !== "completed") {
          this.updateTranscript(
            sessionId,
            message === null ? markPendingMessagesComplete : markPendingMessagesErrored,
          );
        }
      });
    };
    const refs = this.refs.get(sessionId);
    if (refs !== undefined) {
      refs.abort = null;
      refs.runTerminal = true;
    }
    if (runId === null) {
      finalize(undefined, undefined);
      return;
    }
    void getChatRun(runId).then(
      (run) => finalize(run?.status, run?.stoppedReason),
      () => finalize(undefined, undefined),
    );
  }
}

export const chatRunsStore = new ChatRunsStore();
