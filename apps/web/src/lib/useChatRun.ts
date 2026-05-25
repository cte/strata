import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { ChatMessageView, ChatRunState, ChatSubmitInput } from "@/lib/chatRunModel";
import { chatRunsStore, NEW_CHAT_KEY, type SessionRunState } from "@/lib/chatRunsStore";
import { createTokenUsageTotals, type TokenUsageTotals } from "@/lib/chatUsage";
import type { ChatModelChoice } from "@/lib/useChatModelChoice";

export interface UseChatRunOptions {
  /** Currently-selected session id from the URL (or null for a new chat). */
  urlSessionId: string | null;
  /** Active model choice; passed on every `submit`. May be null while loading. */
  selectedModelChoice: ChatModelChoice | null;
  /** Page-level navigation callback. Called with a session id when a new run starts a session, or null for `/clear`. */
  onSessionChange(sessionId: string | null, options?: { replace?: boolean }): void;
}

export interface UseChatRunResult {
  /** Currently-loaded session id (lags `urlSessionId` while a load is in flight). */
  sessionId: string | null;
  sessionTitle: string | null;
  transcript: ChatMessageView[];
  runState: ChatRunState;
  activeRunId: string | null;
  error: string | null;
  setError(message: string | null): void;
  usageTotals: TokenUsageTotals;
  /** Submit a new turn. No-op if the viewed session is mid-run or input is empty. */
  submit(input: ChatSubmitInput): void;
  /** Cancel the viewed session's active run if any. */
  cancel(): void;
  /** Start a fresh chat (the `/clear` slash command). */
  clearSession(): void;
  /** Fork the viewed session into a new one and switch to it. */
  forkSession(): void;
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
  const { urlSessionId, selectedModelChoice, onSessionChange } = options;
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
      transcript: [],
      runState: "idle",
      activeRunId: null,
      error: null,
      usageTotals: createTokenUsageTotals(),
      loaded: false,
    }),
    [runKey, urlSessionId],
  );
  const view = state ?? fallback;

  const submit = useCallback(
    (input: ChatSubmitInput) => {
      chatRunsStore.submit({
        viewKey: runKey,
        input,
        modelChoice: selectedModelChoice,
        navigate: onSessionChange,
      });
    },
    [runKey, selectedModelChoice, onSessionChange],
  );

  const cancel = useCallback(() => {
    chatRunsStore.cancel(runKey);
  }, [runKey]);

  const clearSession = useCallback(() => {
    chatRunsStore.clearDraft(onSessionChange);
  }, [onSessionChange]);

  const forkSession = useCallback(() => {
    chatRunsStore.fork(runKey, onSessionChange);
  }, [runKey, onSessionChange]);

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
    transcript: view.transcript,
    runState: view.runState,
    activeRunId: view.activeRunId,
    error: view.error,
    setError,
    usageTotals: view.usageTotals,
    submit,
    cancel,
    clearSession,
    forkSession,
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
