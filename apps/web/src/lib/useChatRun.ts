import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ChatMessageView, ChatRunState, ChatSubmitInput } from "@/lib/chatRunModel";
import { chatRunsStore, NEW_CHAT_KEY, type SessionRunState } from "@/lib/chatRunsStore";
import { createTokenUsageTotals, type TokenUsageTotals } from "@/lib/chatUsage";
import type { ChatModelChoice } from "@/lib/useChatModelChoice";

export interface UseChatRunOptions {
  /** Currently-selected session id from the URL (or null for a new chat). */
  urlSessionId: string | null;
  /** Page-level navigation callback. Called with a session id when a new run starts a session, or null for `/clear`. */
  onSessionChange(sessionId: string | null, options?: { replace?: boolean }): void;
}

export interface UseChatRunResult {
  /** Currently-loaded session id (lags `urlSessionId` while a load is in flight). */
  sessionId: string | null;
  sessionTitle: string | null;
  sessionModel: string | null;
  sessionLoaded: boolean;
  transcript: ChatMessageView[];
  runState: ChatRunState;
  /** A manual compaction request is in flight for this session. */
  compacting: boolean;
  /** A run is advancing this session in another process/tab (not streamed here). */
  externallyRunning: boolean;
  activeRunId: string | null;
  activeRunStartedAt: string | null;
  error: string | null;
  hasMoreBefore: boolean;
  olderMessagesLoading: boolean;
  setError(message: string | null): void;
  usageTotals: TokenUsageTotals;
  /** Submit a new turn. No-op if the viewed session is mid-run or input is empty. */
  submit(input: ChatSubmitInput, modelChoice: ChatModelChoice | null): void;
  /** Cancel the viewed session's active run if any. */
  cancel(): void;
  /** Manually compact the viewed session. */
  compactSession(): void;
  /** Start a fresh chat (the `/clear` slash command). */
  clearSession(): void;
  /** Fork the viewed session into a new one and switch to it. */
  forkSession(): void;
  /** Load the next older persisted transcript page, when available. */
  loadOlderMessages(): void;
  /** Invalidate cached sessions list (sidebar). */
  refreshSessions(): void;
}

/**
 * Thin view over {@link chatRunsStore} for the currently-selected session. The
 * store owns every run's state and SSE stream, so runs keep streaming while the
 * user looks at a different session; this hook just reads the slice for
 * `urlSessionId` and binds actions to its key.
 */
export function useChatRun(options: UseChatRunOptions): UseChatRunResult {
  const { urlSessionId, onSessionChange } = options;
  const queryClient = useQueryClient();
  const runKey = urlSessionId ?? NEW_CHAT_KEY;

  useEffect(() => {
    chatRunsStore.setQueryClient(queryClient);
  }, [queryClient]);

  // Make sure the viewed session is present in the store (seed persisted
  // transcript), without clobbering a live background stream for it.
  useEffect(() => {
    if (urlSessionId === null) {
      chatRunsStore.ensureDraft();
    } else {
      chatRunsStore.ensureSessionLoaded(urlSessionId);
    }
  }, [urlSessionId]);

  const state = useSyncExternalStore(
    chatRunsStore.subscribe,
    () => chatRunsStore.getState(runKey),
    () => chatRunsStore.getState(runKey),
  );

  const fallback = useMemo<SessionRunState>(
    () => ({
      runKey,
      sessionId: urlSessionId,
      sessionTitle: null,
      sessionModel: null,
      transcript: [],
      runState: "idle",
      compacting: false,
      activeRunId: null,
      activeRunStartedAt: null,
      error: null,
      usageTotals: createTokenUsageTotals(),
      loaded: false,
      hasMoreBefore: false,
      oldestDisplayMessageId: null,
      olderMessagesLoading: false,
      externallyRunning: false,
    }),
    [runKey, urlSessionId],
  );
  const view = state ?? fallback;

  const submit = useCallback(
    (input: ChatSubmitInput, modelChoice: ChatModelChoice | null) => {
      chatRunsStore.submit({
        viewKey: runKey,
        input,
        modelChoice,
        navigate: onSessionChange,
      });
    },
    [runKey, onSessionChange],
  );

  const cancel = useCallback(() => {
    chatRunsStore.cancel(runKey);
  }, [runKey]);

  const compactSession = useCallback(() => {
    chatRunsStore.compact(runKey);
  }, [runKey]);

  const clearSession = useCallback(() => {
    chatRunsStore.clearDraft(onSessionChange);
  }, [onSessionChange]);

  const forkSession = useCallback(() => {
    chatRunsStore.fork(runKey, onSessionChange);
  }, [runKey, onSessionChange]);

  const loadOlderMessages = useCallback(() => {
    chatRunsStore.loadOlder(runKey);
  }, [runKey]);

  const setError = useCallback(
    (message: string | null) => {
      chatRunsStore.setError(runKey, message);
    },
    [runKey],
  );

  const refreshSessions = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
  }, [queryClient]);

  return {
    sessionId: view.sessionId,
    sessionTitle: view.sessionTitle,
    sessionModel: view.sessionModel,
    sessionLoaded: view.loaded,
    transcript: view.transcript,
    runState: view.runState,
    compacting: view.compacting,
    externallyRunning: view.externallyRunning,
    activeRunId: view.activeRunId,
    activeRunStartedAt: view.activeRunStartedAt,
    error: view.error,
    hasMoreBefore: view.hasMoreBefore,
    olderMessagesLoading: view.olderMessagesLoading,
    setError,
    usageTotals: view.usageTotals,
    submit,
    cancel,
    compactSession,
    clearSession,
    forkSession,
    loadOlderMessages,
    refreshSessions,
  };
}

/** Session ids with a live (starting/streaming/cancelling/disconnected) run. */
export function useRunningSessionIds(): ReadonlySet<string> {
  return useSyncExternalStore(
    chatRunsStore.subscribe,
    chatRunsStore.getRunningSessionIds,
    chatRunsStore.getRunningSessionIds,
  );
}
