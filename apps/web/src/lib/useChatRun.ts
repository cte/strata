import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AttachmentData } from "@/components/ai-elements/attachments";
import {
  type ChatImageAttachment,
  type ChatStreamEvent,
  type ChatStreamEventMeta,
  cancelChatRun,
  forkChatSession,
  getChatRun,
  getChatSession,
  listActiveChatRuns,
  type StartChatRunRequest,
  startChatRun,
  streamChatRunEvents,
} from "@/lib/api";
import {
  agentCompletionMessage,
  appendAssistantDelta,
  type ChatMessageView,
  type ChatRunState,
  type ChatSubmitInput,
  clientId,
  completeToolCall,
  errorMessage,
  finalizeAssistantResponse,
  markPendingMessagesComplete,
  markPendingMessagesErrored,
  messagesToTranscript,
  sanitizeDisplayText,
  startToolCall,
  toChatImageAttachment,
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
  /** Submit a new turn. No-op if `runState !== "idle"` or input is empty. */
  submit(input: ChatSubmitInput): void;
  /** Cancel the active run if any. */
  cancel(): void;
  /** Reset transcript + session id (the `/clear` slash command). */
  clearSession(): void;
  /** Fork the active session into a new one and switch to it. */
  forkSession(): void;
  /** Invalidate cached sessions list (sidebar). */
  refreshSessions(): void;
}

/**
 * Owns the in-process model of one chat session as the user experiences it:
 * the URL-driven session detail load, the SSE event stream, the
 * disconnected-and-finished detection, transcript and usage accumulation,
 * cancel and fork. The page consumes the returned values and dispatches via
 * `submit`/`cancel`/`clearSession`/`forkSession` — it doesn't reach into the
 * SSE machinery or run-state refs.
 *
 * Architecturally this is the deepening of what used to be ~500 LoC of
 * state and effects in `apps/web/src/routes/chat.tsx`. The page is now the
 * presentation seam; `useChatRun` is the implementation.
 */
export function useChatRun(options: UseChatRunOptions): UseChatRunResult {
  const { urlSessionId, selectedModelChoice, onSessionChange } = options;
  const queryClient = useQueryClient();

  const [transcript, setTranscript] = useState<ChatMessageView[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sessionTitle, setSessionTitle] = useState<string | null>(null);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [runState, setRunState] = useState<ChatRunState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [usageTotals, setUsageTotals] = useState<TokenUsageTotals>(() => createTokenUsageTotals());

  const abortRef = useRef<AbortController | null>(null);
  const runIdRef = useRef<string | null>(null);
  const lastEventIdRef = useRef(0);
  const reconnectAttemptsRef = useRef(0);
  const runTerminalRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const isRunning = runState !== "idle";

  const refreshSessions = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
  }, [queryClient]);

  // --- Disconnected-stream recovery ---------------------------------------
  const activeRunsQuery = useQuery({
    queryKey: ["chat", "runs", "active"],
    queryFn: listActiveChatRuns,
    enabled: runState === "disconnected",
    refetchInterval: runState === "disconnected" ? 2_000 : false,
  });

  const loadFinishedRun = useCallback((runId: string) => {
    void getChatRun(runId).then(
      (run) => {
        const runSessionId = run?.sessionId ?? sessionIdRef.current;
        if (runSessionId === undefined || runSessionId === null) {
          setError("Live stream disconnected, but the server-side run has finished.");
          return;
        }
        void getChatSession(runSessionId).then(
          (detail) => {
            if (detail !== null) {
              setTranscript(messagesToTranscript(detail.messages));
              setUsageTotals(usageTotalsFromMessages(detail.messages));
            }
            const status = run?.status ?? detail?.session.status;
            const stoppedReason = run?.stoppedReason;
            if (status === "completed") {
              setError("Live stream disconnected, but the server-side run finished.");
              return;
            }
            setError(agentCompletionMessage(status ?? "unknown", stoppedReason));
            setTranscript(markPendingMessagesErrored);
          },
          (cause: unknown) => {
            setError(errorMessage(cause));
          },
        );
      },
      (cause: unknown) => {
        setError(errorMessage(cause));
      },
    );
  }, []);

  useEffect(() => {
    if (runState !== "disconnected" || activeRunId === null || activeRunsQuery.data === undefined) {
      return;
    }
    if (activeRunsQuery.data.some((run) => run.runId === activeRunId)) {
      return;
    }
    runTerminalRef.current = true;
    runIdRef.current = null;
    setActiveRunId(null);
    setRunState("idle");
    void loadFinishedRun(activeRunId);
    refreshSessions();
  }, [activeRunId, activeRunsQuery.data, loadFinishedRun, refreshSessions, runState]);

  // --- URL ?session=<id>  →  in-memory transcript ------------------------
  useEffect(() => {
    if (urlSessionId === sessionId) {
      return;
    }
    if (urlSessionId === null) {
      setSessionTitle(null);
      setTranscript([]);
      setError(null);
      setSessionId(null);
      setUsageTotals(createTokenUsageTotals());
      return;
    }
    let cancelled = false;
    setError(null);
    queryClient
      .fetchQuery({
        queryKey: ["chat", "sessions", "detail", urlSessionId],
        queryFn: () => getChatSession(urlSessionId),
        staleTime: 60_000,
      })
      .then(
        (detail) => {
          if (cancelled) return;
          if (detail === null) {
            setError(`Session not found: ${urlSessionId}`);
            return;
          }
          setSessionId(detail.session.id);
          setSessionTitle(sanitizeDisplayText(detail.session.title));
          setTranscript(messagesToTranscript(detail.messages));
          setUsageTotals(usageTotalsFromMessages(detail.messages));
        },
        (cause: unknown) => {
          if (!cancelled) {
            setError(errorMessage(cause));
          }
        },
      );
    return () => {
      cancelled = true;
    };
  }, [urlSessionId, sessionId, queryClient]);

  // --- SSE event reducer ---------------------------------------------------
  const handleStreamEvent = useCallback(
    (event: ChatStreamEvent, meta: ChatStreamEventMeta = { id: null }) => {
      if (meta.id !== null && meta.id > lastEventIdRef.current) {
        lastEventIdRef.current = meta.id;
      }
      switch (event.type) {
        case "run.started":
          runIdRef.current = event.runId;
          runTerminalRef.current = false;
          setActiveRunId(event.runId);
          setRunState("streaming");
          break;
        case "session.started":
          setSessionId(event.sessionId);
          setSessionTitle(sanitizeDisplayText(event.title));
          onSessionChange(event.sessionId, { replace: true });
          break;
        case "message.user":
          break;
        case "model.request":
          setRunState("streaming");
          break;
        case "model.retry":
          setRunState("streaming");
          break;
        case "assistant.delta":
          setRunState("streaming");
          setTranscript((current) =>
            appendAssistantDelta(current, runIdRef.current, event.iteration, event.contentDelta),
          );
          break;
        case "model.response": {
          const turnUsage =
            event.usage === undefined ? undefined : normalizeModelUsage(event.usage);
          setUsageTotals((current) => accumulateTokenUsage(current, event.usage));
          setTranscript((current) =>
            finalizeAssistantResponse(
              current,
              runIdRef.current,
              event.iteration,
              event.content,
              event.toolCalls,
              turnUsage,
            ),
          );
          break;
        }
        case "tool.call.started":
          setTranscript((current) => startToolCall(current, runIdRef.current, event));
          break;
        case "tool.call.completed":
          setTranscript((current) => completeToolCall(current, event.toolCallId, event.result));
          break;
        case "agent.completed":
          runTerminalRef.current = true;
          setRunState("idle");
          setActiveRunId(null);
          runIdRef.current = null;
          if (event.result.sessionId !== "") {
            setSessionId(event.result.sessionId);
          }
          if (event.result.status !== "completed") {
            setError(agentCompletionMessage(event.result.status, event.result.stoppedReason));
            setTranscript(markPendingMessagesErrored);
          }
          break;
        case "agent.failed":
          runTerminalRef.current = true;
          setError(event.message);
          setRunState("idle");
          setActiveRunId(null);
          runIdRef.current = null;
          setTranscript(markPendingMessagesErrored);
          break;
      }
    },
    [onSessionChange],
  );

  const resumeRunStream = useCallback(
    (runId: string, controller: AbortController): boolean => {
      if (reconnectAttemptsRef.current >= MAX_STREAM_RECONNECTS) {
        return false;
      }
      reconnectAttemptsRef.current += 1;
      setRunState("streaming");
      setError(null);
      streamChatRunEvents(runId, lastEventIdRef.current, handleStreamEvent, controller.signal).then(
        () => {
          if (abortRef.current !== controller) {
            return;
          }
          if (runTerminalRef.current || controller.signal.aborted) {
            setRunState("idle");
            setActiveRunId(null);
            runIdRef.current = null;
            abortRef.current = null;
            refreshSessions();
            return;
          }
          if (!resumeRunStream(runId, controller)) {
            setRunState("disconnected");
            setError(
              "Live stream disconnected before the run finished. The server-side agent may still be running; use Stop to cancel it. The session list will refresh when it finishes.",
            );
            refreshSessions();
          }
        },
        (cause: unknown) => {
          if (abortRef.current !== controller || controller.signal.aborted) {
            return;
          }
          if (!resumeRunStream(runId, controller)) {
            setRunState("disconnected");
            setError(errorMessage(cause));
            refreshSessions();
          }
        },
      );
      return true;
    },
    [handleStreamEvent, refreshSessions],
  );

  // --- Submit / cancel / clear / fork --------------------------------------
  const submit = useCallback(
    (input: ChatSubmitInput) => {
      const message = input.message.trim();
      const hasAttachments = input.attachments.length > 0;
      if ((message === "" && !hasAttachments) || isRunning) {
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      runIdRef.current = null;
      lastEventIdRef.current = 0;
      reconnectAttemptsRef.current = 0;
      runTerminalRef.current = false;
      const sentAttachments = input.attachments;
      const continuingSessionId = sessionIdRef.current;
      if (continuingSessionId === null) {
        setUsageTotals(createTokenUsageTotals());
      }
      setError(null);
      setRunState("starting");
      setTranscript((current) => [
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
      if (selectedModelChoice !== null) {
        request.provider = selectedModelChoice.provider;
        request.model = selectedModelChoice.model;
        request.reasoningEffort = selectedModelChoice.reasoningEffort;
      }

      startChatRun(request, handleStreamEvent, controller.signal).then(
        () => {
          if (abortRef.current === controller) {
            if (runTerminalRef.current || controller.signal.aborted) {
              setRunState("idle");
              setActiveRunId(null);
              runIdRef.current = null;
            } else {
              const runId = runIdRef.current;
              if (runId !== null && resumeRunStream(runId, controller)) {
                return;
              }
              setRunState("disconnected");
              setError(
                "Live stream disconnected before the run finished. The server-side agent may still be running; use Stop to cancel it. The session list will refresh when it finishes.",
              );
            }
            abortRef.current = null;
          }
          refreshSessions();
        },
        (cause: unknown) => {
          const streamDisconnected =
            !controller.signal.aborted && runIdRef.current !== null && !runTerminalRef.current;
          if (abortRef.current === controller) {
            if (streamDisconnected) {
              const runId = runIdRef.current;
              if (runId !== null && resumeRunStream(runId, controller)) {
                return;
              }
              setRunState("disconnected");
              setError(
                "Live stream disconnected before the run finished. The server-side agent may still be running; use Stop to cancel it. The session list will refresh when it finishes.",
              );
            } else {
              setRunState("idle");
              setActiveRunId(null);
              runIdRef.current = null;
            }
            abortRef.current = null;
          }
          if (!controller.signal.aborted) {
            if (!streamDisconnected) {
              setError(errorMessage(cause));
              setTranscript(markPendingMessagesErrored);
            }
          }
          refreshSessions();
        },
      );
    },
    [handleStreamEvent, isRunning, refreshSessions, resumeRunStream, selectedModelChoice],
  );

  const cancel = useCallback(() => {
    if (!isRunning) {
      return;
    }
    const controller = abortRef.current;
    const runId = runIdRef.current;
    setRunState("cancelling");
    const finishLocalCancel = () => {
      controller?.abort();
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
      runTerminalRef.current = true;
      runIdRef.current = null;
      setActiveRunId(null);
      setRunState("idle");
      setTranscript(markPendingMessagesComplete);
      refreshSessions();
    };

    if (runId === null) {
      finishLocalCancel();
      return;
    }

    cancelChatRun(runId).then(
      () => finishLocalCancel(),
      (cause: unknown) => {
        setError(errorMessage(cause));
        finishLocalCancel();
      },
    );
  }, [isRunning, refreshSessions]);

  const clearSession = useCallback(() => {
    if (isRunning) {
      setError("Cannot clear while a run is active.");
      return;
    }
    setTranscript([]);
    setSessionId(null);
    sessionIdRef.current = null;
    setSessionTitle(null);
    setUsageTotals(createTokenUsageTotals());
    setError(null);
    onSessionChange(null);
  }, [isRunning, onSessionChange]);

  const forkSession = useCallback(() => {
    if (isRunning) {
      setError("Cannot fork while a run is active.");
      return;
    }
    const currentSessionId = sessionIdRef.current;
    if (currentSessionId === null) {
      setError("No active session to fork.");
      return;
    }
    setError(null);
    void forkChatSession(currentSessionId).then(
      (detail) => {
        setSessionId(detail.session.id);
        sessionIdRef.current = detail.session.id;
        setSessionTitle(sanitizeDisplayText(detail.session.title));
        setTranscript(messagesToTranscript(detail.messages));
        setUsageTotals(usageTotalsFromMessages(detail.messages));
        onSessionChange(detail.session.id);
        refreshSessions();
      },
      (cause: unknown) => {
        setError(errorMessage(cause));
      },
    );
  }, [isRunning, onSessionChange, refreshSessions]);

  return {
    sessionId,
    sessionTitle,
    transcript,
    runState,
    activeRunId,
    error,
    setError,
    usageTotals,
    submit,
    cancel,
    clearSession,
    forkSession,
    refreshSessions,
  };
}

export type { ChatMessageView, ChatRunState, ChatSubmitInput } from "@/lib/chatRunModel";
