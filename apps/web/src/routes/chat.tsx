import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  horizontalListSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { LanguageModelUsage } from "ai";
import {
  AlertCircle,
  BookOpen,
  Brain,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  Copy,
  FileText,
  GripVertical,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  PencilLine,
  Plus,
  Search,
  Terminal as TerminalIcon,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import type * as React from "react";
import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { useStickToBottomContext } from "use-stick-to-bottom";
import type { AttachmentData } from "@/components/ai-elements/attachments";
import {
  Attachment,
  AttachmentPreview,
  AttachmentRemove,
  Attachments,
  getAttachmentLabel,
  getMediaCategory,
} from "@/components/ai-elements/attachments";
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentFooter,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from "@/components/ai-elements/context";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  PromptInput,
  PromptInputActionAddAttachments,
  PromptInputActionAddScreenshot,
  PromptInputActionMenu,
  PromptInputActionMenuContent,
  PromptInputActionMenuTrigger,
  PromptInputBody,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from "@/components/ai-elements/prompt-input";
import {
  Queue,
  QueueItem,
  QueueItemAction,
  QueueItemActions,
  QueueItemAttachment,
  QueueItemContent,
  QueueItemDescription,
  QueueItemFile,
  QueueItemImage,
  QueueItemIndicator,
  QueueList,
  QueueSection,
  QueueSectionContent,
  QueueSectionLabel,
  QueueSectionTrigger,
} from "@/components/ai-elements/queue";
import { Reasoning, ReasoningContent, ReasoningTrigger } from "@/components/ai-elements/reasoning";
import {
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  Terminal as TerminalOutput,
  TerminalTitle,
} from "@/components/ai-elements/terminal";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { AutocompletePopover } from "@/components/autocomplete-popover";
import { ChatModelPicker } from "@/components/chat-model-picker";
import {
  ChatSessionDeleteConfirm,
  SessionStatusDot,
  useDeleteChatSession,
} from "@/components/chat-session-list";
import { TerminalPanel } from "@/components/terminal-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import {
  addChatQueuedMessage,
  type ChatQueueTarget,
  type ChatSessionSummary,
  clearChatQueuedMessages,
  getChatToolResult,
  invokeChatSkill,
  listChatQueuedMessages,
  moveChatQueuedMessage,
  removeChatQueuedMessage,
  renameChatSession,
  setChatQueuedMessageDelivery,
} from "@/lib/api";
import { useOpenChatSessionCommandPalette } from "@/lib/chatCommandPalette";
import { chatComposerSubmitState } from "@/lib/chatComposer";
import { writeLastChatSessionId } from "@/lib/chatLastSession";
import {
  type QueuedChatMessage,
  type QueuedChatMessageDelivery,
  queuedChatMessageDescription,
  queuedChatMessageFromSummary,
  queuedChatMessageLabel,
} from "@/lib/chatMessageQueue";
import {
  CHAT_NEW_TAB_KEY,
  type ChatPinnedTab,
  chatTabKeyForSession,
  useChatPinnedTabsStore,
} from "@/lib/chatPinnedTabs";
import {
  type ChatMessageView,
  type ChatRunState,
  type ChatToolCallView,
  clientId,
  friendlyChatError,
  MAX_ATTACHMENT_BYTES,
  sanitizeDisplayText,
} from "@/lib/chatRunModel";
import { chatRunsStore } from "@/lib/chatRunsStore";
import { formatRunElapsed } from "@/lib/chatStreamingStatus";
import {
  contextUsagePercent,
  contextWindowForModel,
  formatTokens,
  type TokenUsage,
  type TokenUsageTotals,
} from "@/lib/chatUsage";
import { createFileMentionProvider } from "@/lib/fileMentionProvider";
import { createSkillCommandProvider } from "@/lib/skillCommandProvider";
import {
  createSlashCommandProvider,
  parseSlashCommand,
  slashCommandDefinitions,
} from "@/lib/slashCommandProvider";
import { spinnerVerbForTurnCycle } from "@/lib/spinnerVerbs";
import type { AutocompleteItem } from "@/lib/useAutocomplete";
import { useAutocomplete } from "@/lib/useAutocomplete";
import {
  type ChatModelChoice,
  choiceFromSessionModel,
  useChatModelChoice,
} from "@/lib/useChatModelChoice";
import { useChatPromptHistory } from "@/lib/useChatPromptHistory";

import { useChatRun } from "@/lib/useChatRun";
import { useChatSessions } from "@/lib/useChatSessions";
import { cn } from "@/lib/utils";

/**
 * Publishes a measured element's border-box height as a CSS custom property on
 * `targetRef`, so a floating/absolute element can reserve exact space inside a
 * sibling's scroll flow instead of a hand-tuned constant. Returns the ref to
 * attach to the element being measured.
 */
function usePublishedHeight(
  targetRef: React.RefObject<HTMLElement | null>,
  property: string,
): React.RefObject<HTMLDivElement | null> {
  const measuredRef = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const measured = measuredRef.current;
    const target = targetRef.current;
    if (measured === null || target === null) {
      return;
    }
    const publish = () => {
      target.style.setProperty(property, `${Math.ceil(measured.getBoundingClientRect().height)}px`);
    };
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(measured);
    return () => {
      observer.disconnect();
      target.style.removeProperty(property);
    };
  }, [targetRef, property]);
  return measuredRef;
}

export function ChatPage(): React.ReactElement {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const params = useParams({ strict: false }) as { sessionId?: string } | undefined;
  const search = useSearch({ strict: false }) as { session?: string } | undefined;
  const routeSessionId = params?.sessionId ?? null;
  const legacySessionId =
    typeof search?.session === "string" && search.session.length > 0 ? search.session : null;
  const urlSessionId = routeSessionId ?? legacySessionId;
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [sessionModelOverrides, setSessionModelOverrides] = useState<
    Record<string, ChatModelChoice>
  >({});
  const [showCommandHelp, setShowCommandHelp] = useState(false);
  // `terminalMounted` keeps the PTY session alive: the panel (and its backend
  // session) only unmounts on an explicit close. `terminalMinimized` just
  // collapses the panel to a zero-height bar while leaving the shell connected.
  const [terminalMounted, setTerminalMounted] = useState(false);
  const [terminalMinimized, setTerminalMinimized] = useState(false);
  const terminalPanelRef = useRef<ImperativePanelHandle | null>(null);
  const activeTabKey = chatTabKeyForSession(urlSessionId);
  const prompt = useChatPinnedTabsStore((state) => state.drafts[activeTabKey] ?? "");
  const setDraft = useChatPinnedTabsStore((state) => state.setDraft);
  const clearDraft = useChatPinnedTabsStore((state) => state.clearDraft);
  const activateSessionTab = useChatPinnedTabsStore((state) => state.activateSession);
  const ensureNewTab = useChatPinnedTabsStore((state) => state.ensureNewTab);
  const replaceNewTabWithSession = useChatPinnedTabsStore((state) => state.replaceNewWithSession);
  const syncPinnedTabs = useChatPinnedTabsStore((state) => state.syncSessions);
  const { allSessions, isLoaded: sessionsLoaded, sessionIndexComplete } = useChatSessions();
  const setPrompt = useCallback(
    (value: string) => {
      setDraft(activeTabKey, value);
    },
    [activeTabKey, setDraft],
  );

  const handleOpenTerminal = useCallback(() => {
    setTerminalMounted(true);
    setTerminalMinimized(false);
    terminalPanelRef.current?.expand();
  }, []);

  const handleMinimizeTerminal = useCallback(() => {
    setTerminalMinimized(true);
    terminalPanelRef.current?.collapse();
  }, []);

  const handleCloseTerminal = useCallback(() => {
    setTerminalMounted(false);
    setTerminalMinimized(false);
  }, []);

  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const requestScrollToBottomRef = useRef<(() => void) | null>(null);
  const chatSectionRef = useRef<HTMLElement | null>(null);
  const composerRef = usePublishedHeight(chatSectionRef, "--composer-h");
  const autocompleteProviders = useMemo(
    () => [createSkillCommandProvider(), createSlashCommandProvider(), createFileMentionProvider()],
    [],
  );
  const {
    choice: selectedModelChoice,
    providerStates: modelProviderStates,
    setChoice: setModelChoice,
    setReasoningEffort: setModelReasoningEffort,
  } = useChatModelChoice();
  const { record: recordPromptHistory, onKeyDown: onPromptHistoryKeyDown } =
    useChatPromptHistory(setPrompt);
  useEffect(() => {
    const session =
      urlSessionId === null ? null : allSessions.find((entry) => entry.id === urlSessionId);
    if (urlSessionId === null) {
      // On the new-chat route, surface a "New session" placeholder tab that
      // becomes the active tab and converts in place once the first turn
      // persists the session.
      ensureNewTab();
      return;
    }
    activateSessionTab(urlSessionId, session?.title ?? null);
  }, [activateSessionTab, allSessions, ensureNewTab, urlSessionId]);

  useEffect(() => {
    if (!sessionsLoaded) {
      return;
    }
    syncPinnedTabs(allSessions, { pruneMissing: sessionIndexComplete });
  }, [allSessions, sessionIndexComplete, sessionsLoaded, syncPinnedTabs]);

  const queueRefreshNonce = useSyncExternalStore(
    chatRunsStore.subscribe,
    chatRunsStore.getQueueRefreshVersion,
    chatRunsStore.getQueueRefreshVersion,
  );

  useEffect(() => {
    if (routeSessionId !== null || legacySessionId === null) {
      return;
    }
    void navigate({
      to: "/chat/$sessionId",
      params: { sessionId: legacySessionId },
      replace: true,
    });
  }, [legacySessionId, navigate, routeSessionId]);

  useEffect(() => {
    if (urlSessionId !== null) {
      writeLastChatSessionId(urlSessionId);
    }
  }, [urlSessionId]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      promptInputRef.current?.focus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [pathname, urlSessionId]);

  const handleSessionChange = useCallback(
    (newSessionId: string | null, options?: { replace?: boolean }) => {
      if (newSessionId === null) {
        void navigate({
          to: "/chat",
          replace: options?.replace ?? false,
        });
        return;
      }
      replaceNewTabWithSession(newSessionId, null);
      void navigate({
        to: "/chat/$sessionId",
        params: { sessionId: newSessionId },
        replace: options?.replace ?? false,
      });
    },
    [navigate, replaceNewTabWithSession],
  );

  const chatRun = useChatRun({
    urlSessionId,
    onSessionChange: handleSessionChange,
  });
  const {
    sessionId,
    sessionModel,
    sessionLoaded,
    transcript,
    runState,
    compacting,
    externallyRunning,
    activeRunId,
    activeRunStartedAt,
    error,
    hasMoreBefore,
    olderMessagesLoading,
    setError,
    usageTotals,
    submit,
    cancel,
    compactSession,
    clearSession,
    forkSession,
    loadOlderMessages,
  } = chatRun;

  const activeSessionModelOverride =
    sessionId === null ? null : (sessionModelOverrides[sessionId] ?? null);
  const sessionModelChoice = useMemo(
    () =>
      activeSessionModelOverride ??
      choiceFromSessionModel(
        sessionModel,
        modelProviderStates,
        selectedModelChoice?.reasoningEffort ?? "off",
        selectedModelChoice,
      ),
    [activeSessionModelOverride, modelProviderStates, selectedModelChoice, sessionModel],
  );
  const effectiveModelChoice =
    sessionId === null ? selectedModelChoice : (sessionModelChoice ?? selectedModelChoice);
  const handleModelSelect = useCallback(
    (choice: ChatModelChoice) => {
      if (sessionId !== null) {
        setSessionModelOverrides((current) => ({ ...current, [sessionId]: choice }));
      }
      setModelChoice(choice);
    },
    [sessionId, setModelChoice],
  );
  const handleReasoningEffortChange = useCallback(
    (effort: ChatModelChoice["reasoningEffort"]) => {
      if (sessionId !== null && effectiveModelChoice !== null) {
        setSessionModelOverrides((current) => ({
          ...current,
          [sessionId]: { ...effectiveModelChoice, reasoningEffort: effort },
        }));
      }
      setModelReasoningEffort(effort);
    },
    [effectiveModelChoice, sessionId, setModelReasoningEffort],
  );

  const queueTarget = useMemo<ChatQueueTarget>(() => {
    if (sessionId !== null) {
      return { sessionId };
    }
    if (activeRunId !== null) {
      return { runId: activeRunId };
    }
    return {};
  }, [activeRunId, sessionId]);

  useEffect(() => {
    let cancelled = false;
    void refreshQueuedMessages(queueTarget).then((messages) => {
      if (!cancelled) {
        setQueuedMessages(messages);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [queueRefreshNonce, queueTarget]);

  const isRunning = runState !== "idle";
  // A run is advancing this session in another process/tab; lock the composer
  // since the server allows only one active run per session.
  const composerDisabled =
    runState === "cancelling" ||
    externallyRunning ||
    compacting ||
    (urlSessionId !== null && !sessionLoaded);
  const selectedProvider = effectiveModelChoice?.provider ?? null;
  const selectedModel = effectiveModelChoice?.model ?? null;
  const contextWindow = useMemo(
    () =>
      selectedProvider === null || selectedModel === null
        ? undefined
        : contextWindowForModel(selectedProvider, selectedModel),
    [selectedProvider, selectedModel],
  );

  const submitSkillCommand = useCallback(
    async (args: string) => {
      const [name, ...rest] = args.trim().split(/\s+/);
      if (name === undefined || name === "") {
        setError("Usage: /skill:<name> [instructions]");
        return;
      }
      try {
        const invocation = await invokeChatSkill(name, rest.join(" "));
        if (isRunning) {
          void enqueueChatMessage(queueTarget, {
            id: clientId("queued"),
            message: invocation.prompt,
            attachments: [],
            delivery: queuedDeliveryForSubmission(),
          }).then(setQueuedMessages, (error: unknown) => setError(errorMessage(error)));
          return;
        }
        submit({ message: invocation.prompt, attachments: [] }, effectiveModelChoice);
      } catch (error: unknown) {
        setError(error instanceof Error ? error.message : String(error));
      }
    },
    [effectiveModelChoice, isRunning, queueTarget, setError, submit],
  );

  const handleSlashCommand = useCallback(
    (input: string) => {
      const parsed = parseSlashCommand(input);
      if (parsed === undefined) {
        setError(`Unknown command: ${input.trim()}`);
        return;
      }
      switch (parsed.name) {
        case "clear":
          if (!isRunning) {
            void clearChatQueuedMessages(queueTarget).then(() => setQueuedMessages([]));
          }
          clearSession();
          setShowCommandHelp(false);
          return;
        case "compact":
          compactSession();
          setShowCommandHelp(false);
          return;
        case "fork":
          forkSession();
          setShowCommandHelp(false);
          return;
        case "help":
          setError(null);
          setShowCommandHelp(true);
          return;
        case "model":
          setError(null);
          setShowCommandHelp(false);
          setModelPickerOpen(true);
          return;
        case "skill":
          setError(null);
          setShowCommandHelp(false);
          void submitSkillCommand(parsed.args);
          return;
      }
    },
    [
      clearSession,
      compactSession,
      forkSession,
      isRunning,
      queueTarget,
      setError,
      submitSkillCommand,
    ],
  );

  const handleAutocompleteCommit = useCallback(
    (item: AutocompleteItem, value: string) => {
      if (item.kind !== "command") {
        return;
      }
      recordPromptHistory(value);
      clearDraft(activeTabKey);
      handleSlashCommand(value);
    },
    [activeTabKey, clearDraft, handleSlashCommand, recordPromptHistory],
  );

  const autocomplete = useAutocomplete(promptInputRef, {
    value: prompt,
    providers: autocompleteProviders,
    onValueChange: setPrompt,
    disabled: runState === "cancelling",
    onCommit: handleAutocompleteCommit,
  });

  const handlePromptUnhandledKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (autocomplete.onKeyDown(event)) {
        return;
      }
      onPromptHistoryKeyDown(event, prompt);
    },
    [autocomplete, onPromptHistoryKeyDown, prompt],
  );

  const handleSubmit = useCallback(
    (input: PromptInputMessage) => {
      const message = input.text.trim();
      const attachments: AttachmentData[] = input.files.map((file) => ({
        ...file,
        id: clientId("att"),
      }));
      const hasAttachments = attachments.length > 0;
      if (message === "" && !hasAttachments) {
        return;
      }
      if (!hasAttachments && message.startsWith("/")) {
        recordPromptHistory(message);
        clearDraft(activeTabKey);
        handleSlashCommand(message);
        return;
      }
      if (externallyRunning) {
        return;
      }
      recordPromptHistory(message);
      clearDraft(activeTabKey);
      setShowCommandHelp(false);
      setModelPickerOpen(false);
      // Re-engage stick-to-bottom so the just-sent message stays in view when
      // the user had scrolled up; a no-op if already pinned to the bottom.
      requestScrollToBottomRef.current?.();
      if (isRunning) {
        void enqueueChatMessage(queueTarget, {
          id: clientId("queued"),
          message,
          attachments,
          delivery: queuedDeliveryForSubmission(),
        }).then(setQueuedMessages, (error: unknown) => setError(errorMessage(error)));
        return;
      }
      submit({ message, attachments }, effectiveModelChoice);
    },
    [
      activeTabKey,
      clearDraft,
      effectiveModelChoice,
      externallyRunning,
      handleSlashCommand,
      isRunning,
      queueTarget,
      recordPromptHistory,
      setError,
      submit,
    ],
  );

  const handlePromptInputError = useCallback(
    (inputError: { code: string; message: string }) => {
      if (inputError.code === "max_file_size") {
        setError(
          `Files must be ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB or smaller.`,
        );
        return;
      }
      setError(inputError.message);
    },
    [setError],
  );

  const handleRemoveQueuedMessage = useCallback((id: string) => {
    void removeChatQueuedMessage(id).then((removed) => {
      if (removed) {
        setQueuedMessages((current) => current.filter((message) => message.id !== id));
      }
    });
  }, []);

  const handleReorderQueuedMessage = useCallback(
    (id: string, beforeId: string | null) => {
      setQueuedMessages((current) => reorderQueuedMessages(current, id, beforeId));
      void moveChatQueuedMessage({ id, beforeId }).then(
        () => refreshQueuedMessages(queueTarget).then(setQueuedMessages),
        (error: unknown) => {
          setError(errorMessage(error));
          void refreshQueuedMessages(queueTarget).then(setQueuedMessages);
        },
      );
    },
    [queueTarget, setError],
  );

  const handleSteerQueuedMessage = useCallback(
    (id: string) => {
      setQueuedMessages((current) =>
        current.map((message) =>
          message.id === id ? { ...message, delivery: "steering" } : message,
        ),
      );
      requestScrollToBottomRef.current?.();
      void setChatQueuedMessageDelivery({ id, delivery: "steering" }).then(
        () => refreshQueuedMessages(queueTarget).then(setQueuedMessages),
        (error: unknown) => {
          setError(errorMessage(error));
          void refreshQueuedMessages(queueTarget).then(setQueuedMessages);
        },
      );
    },
    [queueTarget, setError],
  );

  const handleCancel = useCallback(() => {
    void clearChatQueuedMessages(queueTarget).then(() => setQueuedMessages([]));
    cancel();
  }, [cancel, queueTarget]);

  const visibleQueuedMessages = useMemo(
    () => queuedMessages.filter((message) => message.delivery === "follow-up"),
    [queuedMessages],
  );
  const displayedTranscript = useMemo(
    () => transcriptWithPendingSteering(transcript, queuedMessages),
    [queuedMessages, transcript],
  );

  const modelLine = useMemo(() => {
    if (selectedModelChoice === null) {
      return "model loading";
    }
    const effort =
      selectedModelChoice.reasoningEffort === "off"
        ? ""
        : ` / ${selectedModelChoice.reasoningEffort}`;
    return `${selectedModelChoice.provider} / ${selectedModelChoice.model}${effort}`;
  }, [selectedModelChoice]);
  const [restoredScrollTabKey, setRestoredScrollTabKey] = useState(activeTabKey);
  const conversationContentVisible = sessionLoaded && restoredScrollTabKey === activeTabKey;
  const handleConversationScrollRestored = useCallback((tabKey: string) => {
    setRestoredScrollTabKey(tabKey);
  }, []);

  return (
    <div className="chat-surface relative flex min-h-0 flex-1 flex-col overflow-hidden bg-bg">
      <ResizablePanelGroup
        direction="vertical"
        autoSaveId="strata-chat-terminal"
        className="min-h-0 flex-1"
      >
        <ResizablePanel id="chat" order={1} minSize={30} className="!overflow-hidden">
          <section ref={chatSectionRef} className="relative flex h-full min-h-0 min-w-0 flex-col">
            <ChatPinnedTabBar sessionId={urlSessionId} />

            {error === null ? null : (
              <InlineError message={error} onDismiss={() => setError(null)} />
            )}
            {showCommandHelp ? <CommandHelp onClose={() => setShowCommandHelp(false)} /> : null}

            <Conversation className="min-h-0 flex-1">
              <ConversationContent
                className={cn(
                  // Empty state keeps ConversationContent's default pb; the transcript
                  // branch zeroes it so the in-flow composer spacer below is the ONLY
                  // bottom reservation (otherwise the base pb-32 stacks with the spacer
                  // and leaves a large dead gap above the composer).
                  transcript.length === 0 ? "min-h-full" : "pb-0",
                  !conversationContentVisible && "invisible",
                )}
                aria-busy={!conversationContentVisible}
              >
                {displayedTranscript.length === 0 ? (
                  urlSessionId === null ? (
                    <InlineChatEmptyState />
                  ) : (
                    <ConversationEmptyState
                      title="Ready."
                      description={modelLine}
                      icon={<MessageSquare size={14} strokeWidth={1.75} />}
                    />
                  )
                ) : (
                  <>
                    {hasMoreBefore ? (
                      <LoadOlderMessagesButton
                        loading={olderMessagesLoading}
                        onClick={loadOlderMessages}
                      />
                    ) : null}
                    {displayedTranscript.map((message) => (
                      <TranscriptMessage key={message.id} message={message} sessionId={sessionId} />
                    ))}
                    {/*
                     * Reserve space for the absolutely-positioned composer as a real
                     * layout child rather than paddingBottom on the scroll content.
                     * use-stick-to-bottom observes the content BOX height (contentRect
                     * excludes padding), so composer-height changes published to
                     * --composer-h must grow an in-flow element to trigger its resize
                     * observer and re-pin to the bottom. A padding-based reservation is
                     * invisible to it and makes autoscroll flaky.
                     */}
                    <div
                      aria-hidden="true"
                      className="shrink-0"
                      style={{ height: "calc(var(--composer-h, 13rem) + 1rem)" }}
                    />
                  </>
                )}
              </ConversationContent>
              <ConversationTabBottomController
                tabKey={activeTabKey}
                ready={sessionLoaded}
                visible={conversationContentVisible}
                onRestored={handleConversationScrollRestored}
                scrollRequestRef={requestScrollToBottomRef}
              />
              {conversationContentVisible ? <ConversationScrollButton /> : null}
            </Conversation>

            <div
              ref={composerRef}
              className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pt-8 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:px-6 md:pb-[max(1rem,env(safe-area-inset-bottom))]"
            >
              {/*
               * Full-width frosted backdrop behind the composer column. It blurs
               * and obscures any transcript text that scrolls under the docked
               * composer (including behind the streaming-status row, which has no
               * opaque background of its own). A top mask fades the blur in over
               * the dock's top padding so messages dissolve gradually above the
               * streaming indicator instead of hitting a hard edge or clashing
               * with it.
               */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 bg-[color-mix(in_oklab,var(--bg)_72%,transparent)] backdrop-blur-md [mask-image:linear-gradient(to_bottom,transparent,black_2rem)]"
              />
              <div className="pointer-events-auto relative mx-auto flex w-full max-w-3xl flex-col gap-2">
                <div className="flex justify-start px-1">
                  <RunStatusBadge
                    runState={runState}
                    externallyRunning={externallyRunning}
                    compacting={compacting}
                    startedAt={activeRunStartedAt}
                    turnSeed={activeRunStartedAt ?? activeRunId}
                  />
                </div>
                <PromptInput
                  key={activeTabKey}
                  accept="image/*"
                  globalDrop
                  maxFileSize={MAX_ATTACHMENT_BYTES}
                  multiple
                  onError={handlePromptInputError}
                  onSubmit={handleSubmit}
                  className="rounded-md bg-bg-elev [&_[data-slot=input-group]]:rounded-md [&_[data-slot=input-group]]:border-hairline [&_[data-slot=input-group]]:bg-bg-elev [&_[data-slot=input-group]]:shadow-none"
                >
                  <AutocompletePopover
                    open={autocomplete.open}
                    items={autocomplete.items}
                    selectedIndex={autocomplete.selectedIndex}
                    anchorRect={autocomplete.anchorRect}
                    onAccept={autocomplete.accept}
                    onSelect={autocomplete.select}
                  />
                  <ChatPromptHeader
                    queuedMessages={visibleQueuedMessages}
                    onSteerQueuedMessage={handleSteerQueuedMessage}
                    onRemoveQueuedMessage={handleRemoveQueuedMessage}
                    onReorderQueuedMessage={handleReorderQueuedMessage}
                  />
                  <PromptInputBody>
                    <PromptInputTextarea
                      inputRef={promptInputRef}
                      value={prompt}
                      onChange={(event) => setPrompt(event.currentTarget.value)}
                      onFocus={autocomplete.refresh}
                      onKeyDown={handlePromptUnhandledKeyDown}
                      disabled={composerDisabled}
                      className="min-h-12 text-sm leading-5 md:text-sm"
                    />
                  </PromptInputBody>
                  <PromptInputFooter>
                    <PromptInputTools>
                      <PromptInputActionMenu>
                        <PromptInputActionMenuTrigger disabled={composerDisabled} />
                        <PromptInputActionMenuContent>
                          <PromptInputActionAddAttachments label="Attach image" />
                          <PromptInputActionAddScreenshot />
                        </PromptInputActionMenuContent>
                      </PromptInputActionMenu>
                      <ChatModelPicker
                        choice={effectiveModelChoice}
                        providerStates={modelProviderStates}
                        open={modelPickerOpen}
                        onOpenChange={setModelPickerOpen}
                        onSelect={handleModelSelect}
                        onReasoningEffortChange={handleReasoningEffortChange}
                        disabled={composerDisabled}
                      />
                    </PromptInputTools>
                    <PromptInputTools className="shrink-0 justify-end gap-2">
                      <ContextUsageIndicator usage={usageTotals} contextWindow={contextWindow} />
                      <ChatPromptSubmit
                        prompt={prompt}
                        runState={runState}
                        externallyRunning={externallyRunning}
                        compacting={compacting}
                        onStop={handleCancel}
                      />
                    </PromptInputTools>
                  </PromptInputFooter>
                </PromptInput>
              </div>
            </div>
          </section>
        </ResizablePanel>
        {terminalMounted ? (
          <>
            {terminalMinimized ? null : <ResizableHandle withHandle />}
            <ResizablePanel
              ref={terminalPanelRef}
              id="terminal"
              order={2}
              collapsible
              collapsedSize={0}
              defaultSize={38}
              minSize={12}
              maxSize={85}
              onCollapse={() => setTerminalMinimized(true)}
              onExpand={() => setTerminalMinimized(false)}
              className="!overflow-hidden"
            >
              <TerminalPanel onMinimize={handleMinimizeTerminal} onClose={handleCloseTerminal} />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>
      {terminalMounted && !terminalMinimized ? null : (
        <button
          type="button"
          onClick={handleOpenTerminal}
          aria-expanded={false}
          aria-label={terminalMounted ? "Expand terminal (session running)" : "Open terminal"}
          title={terminalMounted ? "Expand terminal (session running)" : "Open terminal"}
          className="flex h-9 shrink-0 items-center gap-2 border-hairline border-t bg-bg-elev px-3 text-fg-dim transition-colors hover:bg-surface-2 hover:text-fg"
        >
          <TerminalIcon size={13} strokeWidth={1.75} />
          <span className="text-xs font-medium">Terminal</span>
          {terminalMounted ? (
            <span className="ml-1 size-2 shrink-0 rounded-full bg-good" aria-hidden />
          ) : null}
          <ChevronUp size={14} strokeWidth={1.75} className="ml-auto" />
        </button>
      )}
    </div>
  );
}

function ConversationTabBottomController({
  tabKey,
  ready,
  visible,
  onRestored,
  scrollRequestRef,
}: {
  tabKey: string;
  ready: boolean;
  visible: boolean;
  onRestored(tabKey: string): void;
  scrollRequestRef: React.RefObject<(() => void) | null>;
}): null {
  const { scrollRef, scrollToBottom, state } = useStickToBottomContext();
  const restoredTabKeyRef = useRef<string | null>(null);

  // Expose a smooth "scroll to bottom unless already there" to ChatPage, which
  // lives outside the StickToBottom context and so can't read it directly.
  useEffect(() => {
    scrollRequestRef.current = () => {
      if (state.isAtBottom) {
        return;
      }
      void scrollToBottom();
    };
    return () => {
      scrollRequestRef.current = null;
    };
  }, [scrollRequestRef, scrollToBottom, state]);

  const forceScrollToBottom = useCallback(() => {
    const scrollElement = scrollRef.current;
    if (scrollElement === null) {
      return;
    }
    delete state.animation;
    state.scrollTop = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    void scrollToBottom({ animation: "instant", ignoreEscapes: true });
  }, [scrollRef, scrollToBottom, state]);

  useLayoutEffect(() => {
    if (!ready || restoredTabKeyRef.current === tabKey) {
      return;
    }
    restoredTabKeyRef.current = tabKey;
    forceScrollToBottom();
    const frame = window.requestAnimationFrame(() => {
      if (restoredTabKeyRef.current !== tabKey) {
        return;
      }
      forceScrollToBottom();
      onRestored(tabKey);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [forceScrollToBottom, onRestored, ready, tabKey]);

  useLayoutEffect(() => {
    if (!visible || !ready || restoredTabKeyRef.current !== tabKey) {
      return;
    }
    forceScrollToBottom();
    const frame = window.requestAnimationFrame(forceScrollToBottom);
    return () => window.cancelAnimationFrame(frame);
  }, [forceScrollToBottom, ready, tabKey, visible]);

  return null;
}

async function refreshQueuedMessages(target: ChatQueueTarget): Promise<QueuedChatMessage[]> {
  if (target.sessionId === undefined && target.runId === undefined) {
    return [];
  }
  const messages = await listChatQueuedMessages(target);
  return messages.map(queuedChatMessageFromSummary);
}

async function enqueueChatMessage(
  target: ChatQueueTarget,
  message: QueuedChatMessage,
): Promise<QueuedChatMessage[]> {
  if (target.sessionId === undefined && target.runId === undefined) {
    return [];
  }
  await addChatQueuedMessage({
    ...target,
    id: message.id,
    message: message.message,
    attachments: message.attachments,
    delivery: message.delivery,
  });
  return refreshQueuedMessages(target);
}

function queuedDeliveryForSubmission(): QueuedChatMessageDelivery {
  return "follow-up";
}

function transcriptWithPendingSteering(
  transcript: ChatMessageView[],
  queuedMessages: QueuedChatMessage[],
): ChatMessageView[] {
  const existingClientIds = new Set(
    transcript
      .map((message) => message.clientMessageId)
      .filter((id): id is string => id !== undefined),
  );
  const pending = queuedMessages
    .filter((message) => message.delivery === "steering" && !existingClientIds.has(message.id))
    .map(queuedSteeringMessageToTranscript);
  return pending.length === 0 ? transcript : [...transcript, ...pending];
}

function queuedSteeringMessageToTranscript(message: QueuedChatMessage): ChatMessageView {
  return {
    id: `pending-user-${message.id}`,
    role: "user",
    content:
      message.message.trim() === "" && message.attachments.length > 0
        ? "(image attached)"
        : message.message,
    status: "streaming",
    toolCalls: [],
    clientMessageId: message.id,
    pendingKind: "steering",
    ...(message.attachments.length === 0 ? {} : { attachments: message.attachments }),
  };
}

function reorderQueuedMessages(
  messages: QueuedChatMessage[],
  id: string,
  beforeId: string | null,
): QueuedChatMessage[] {
  const moving = messages.find((message) => message.id === id);
  if (moving === undefined) {
    return messages;
  }
  const remaining = messages.filter((message) => message.id !== id);
  const index =
    beforeId === null
      ? remaining.length
      : remaining.findIndex((message) => message.id === beforeId);
  const insertAt = index === -1 ? remaining.length : index;
  return [...remaining.slice(0, insertAt), moving, ...remaining.slice(insertAt)];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Chat-local top bar with browser-like pinned session tabs, a new-chat button,
 * and a session search button (opens the command palette). Tabs are local
 * browser UI state; closing one does not delete the underlying session.
 */
function ChatPinnedTabBar({ sessionId }: { sessionId: string | null }): React.ReactElement {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const openCommandPalette = useOpenChatSessionCommandPalette();
  const { allSessions: sessions } = useChatSessions();
  const deleteSession = useDeleteChatSession();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const tabs = useChatPinnedTabsStore((state) => state.tabs);
  const activeTabKey = chatTabKeyForSession(sessionId);
  const closeTab = useChatPinnedTabsStore((state) => state.closeTab);
  const reorderTabs = useChatPinnedTabsStore((state) => state.reorderTabs);
  const activateSessionTab = useChatPinnedTabsStore((state) => state.activateSession);
  const renameSessionTab = useChatPinnedTabsStore((state) => state.renameSession);
  const session = useMemo(
    () => (sessionId === null ? null : (sessions.find((entry) => entry.id === sessionId) ?? null)),
    [sessionId, sessions],
  );
  const canDelete = session !== null && session.status !== "running";
  const tabKeys = useMemo(() => tabs.map((tab) => tab.key), [tabs]);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const navigateToTab = useCallback(
    (tab: ChatPinnedTab | null, options?: { replace?: boolean }) => {
      if (tab === null || tab.sessionId === null) {
        void navigate({ to: "/chat", replace: options?.replace ?? false });
        return;
      }
      activateSessionTab(tab.sessionId, tab.titleSnapshot);
      void navigate({
        to: "/chat/$sessionId",
        params: { sessionId: tab.sessionId },
        replace: options?.replace ?? false,
      });
    },
    [activateSessionTab, navigate],
  );

  const handleNewChat = useCallback(() => {
    void navigate({ to: "/chat" });
  }, [navigate]);

  const handleSelectTab = useCallback(
    (tab: ChatPinnedTab) => {
      navigateToTab(tab);
    },
    [navigateToTab],
  );

  const handleCloseTab = useCallback(
    (tab: ChatPinnedTab) => {
      const next = closeTab(tab.key, activeTabKey);
      if (tab.key === activeTabKey) {
        navigateToTab(next, { replace: true });
      }
    },
    [activeTabKey, closeTab, navigateToTab],
  );

  const handleTabDragEnd = useCallback(
    (event: DragEndEvent) => {
      const overId = event.over?.id;
      if (overId === undefined || event.active.id === overId) {
        return;
      }
      reorderTabs(String(event.active.id), String(overId));
    },
    [reorderTabs],
  );

  const handleRenameTab = useCallback(
    async (tab: ChatPinnedTab, title: string): Promise<void> => {
      if (tab.sessionId === null) {
        return;
      }
      const renamed = await renameChatSession(tab.sessionId, title);
      renameSessionTab(renamed.id, renamed.title);
      chatRunsStore.renameSession(renamed.id, renamed.title);
      await queryClient.invalidateQueries({ queryKey: ["chat", "sessions"] });
    },
    [queryClient, renameSessionTab],
  );

  const handleDeleteTab = useCallback(
    async (tabSession: ChatSessionSummary): Promise<void> => {
      await deleteSession(tabSession);
    },
    [deleteSession],
  );

  const handleConfirmOpenChange = useCallback(
    (next: boolean) => {
      if (deleting) {
        return;
      }
      setConfirmOpen(next);
      if (!next) {
        setDeleteError(null);
      }
    },
    [deleting],
  );

  const confirmDelete = useCallback(() => {
    if (session === null || !canDelete || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    void deleteSession(session).then(
      () => {
        setDeleting(false);
        setConfirmOpen(false);
      },
      (cause: unknown) => {
        setDeleteError(cause instanceof Error ? cause.message : String(cause));
        setDeleting(false);
      },
    );
  }, [canDelete, deleteSession, deleting, session]);

  // Keyboard shortcuts (⌘K for the session picker lives with the palette):
  // ⌘⇧O starts a new session, ⌘⇧⌫ opens the delete confirm. Mirrors the
  // new-chat button, the search button, and the per-tab delete action.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (!event.shiftKey) return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        handleNewChat();
      } else if (event.key === "Backspace" && canDelete) {
        event.preventDefault();
        setConfirmOpen(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canDelete, handleNewChat]);

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-hairline bg-[color-mix(in_oklab,var(--bg)_92%,transparent)] p-1 backdrop-blur-md">
      <DndContext
        sensors={dragSensors}
        collisionDetection={closestCenter}
        modifiers={CHAT_TAB_DRAG_MODIFIERS}
        onDragEnd={handleTabDragEnd}
      >
        <SortableContext items={tabKeys} strategy={horizontalListSortingStrategy}>
          <ChatTabScroller>
            {tabs.map((tab) => {
              const tabSession =
                tab.sessionId === null
                  ? null
                  : (sessions.find((entry) => entry.id === tab.sessionId) ?? null);
              return (
                <ChatPinnedTabButton
                  key={tab.key}
                  tab={tab}
                  active={tab.key === activeTabKey}
                  session={tabSession}
                  onSelect={() => handleSelectTab(tab)}
                  onClose={() => handleCloseTab(tab)}
                  onRename={(title) => handleRenameTab(tab, title)}
                  onDelete={tabSession === null ? undefined : () => handleDeleteTab(tabSession)}
                />
              );
            })}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="New chat"
              title="New chat"
              onClick={handleNewChat}
              className="h-7 w-7 shrink-0 rounded-md text-fg-dim hover:bg-fg/[0.03] hover:text-fg [&>svg]:!size-3.5"
            >
              <Plus size={14} strokeWidth={1.75} />
            </Button>
          </ChatTabScroller>
        </SortableContext>
      </DndContext>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Search sessions"
        title="Search sessions (⌘K)"
        onClick={openCommandPalette}
        className="h-7 w-7 rounded-md text-fg-dim hover:bg-fg/[0.03] hover:text-fg [&>svg]:!size-3.5"
      >
        <Search size={14} strokeWidth={1.75} />
      </Button>
      <Dialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
        <DialogContent className="max-w-sm border-hairline bg-bg-elev p-4 text-fg">
          <DialogHeader className="sr-only">
            <DialogTitle>Delete session?</DialogTitle>
            <DialogDescription>
              This permanently removes the chat session you are viewing.
            </DialogDescription>
          </DialogHeader>
          <ChatSessionDeleteConfirm
            title={session === null ? "this session" : session.title}
            deleting={deleting}
            error={deleteError}
            onCancel={() => handleConfirmOpenChange(false)}
            onConfirm={confirmDelete}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * Horizontal tab strip viewport. Replaces the browser's chunky native
 * horizontal scrollbar with an elegant treatment: the native scrollbar is
 * hidden, the over-scrolled edges fade out behind a gradient mask, and small
 * chevron buttons appear only on the side(s) that can still scroll. Vertical
 * wheel gestures are translated to horizontal scrolling so a trackpad/mouse can
 * move through tabs without a visible scrollbar.
 */
function ChatTabScroller({ children }: { children: React.ReactNode }): React.ReactElement {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [overflow, setOverflow] = useState<{ start: boolean; end: boolean }>({
    start: false,
    end: false,
  });

  const syncOverflow = useCallback(() => {
    const el = viewportRef.current;
    if (el === null) {
      return;
    }
    const max = el.scrollWidth - el.clientWidth;
    const start = el.scrollLeft > 1;
    const end = el.scrollLeft < max - 1;
    setOverflow((prev) => (prev.start === start && prev.end === end ? prev : { start, end }));
  }, []);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (el === null) {
      return;
    }
    syncOverflow();
    const observer = new ResizeObserver(syncOverflow);
    observer.observe(el);
    for (const child of Array.from(el.children)) {
      observer.observe(child);
    }
    return () => observer.disconnect();
  }, [syncOverflow]);

  const scrollByStep = useCallback((direction: 1 | -1) => {
    const el = viewportRef.current;
    if (el === null) {
      return;
    }
    el.scrollBy({ left: direction * Math.max(el.clientWidth * 0.6, 160), behavior: "smooth" });
  }, []);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    const el = viewportRef.current;
    if (el === null) {
      return;
    }
    // Translate the dominant vertical wheel delta into horizontal motion so the
    // strip scrolls without a visible scrollbar. Honor native horizontal wheel
    // (trackpad) deltas as-is.
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) {
        return;
      }
      el.scrollLeft += event.deltaY;
    }
  }, []);

  return (
    <div className="relative flex min-w-0 flex-1 items-center">
      <div
        ref={viewportRef}
        onScroll={syncOverflow}
        onWheel={handleWheel}
        className={cn(
          "no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto scroll-smooth",
          // Fade the content out at whichever edge can still scroll, so tabs
          // dissolve into the bar instead of being hard-cut by a scrollbar.
          overflow.start && overflow.end && "chat-tab-fade-both",
          overflow.start && !overflow.end && "chat-tab-fade-start",
          !overflow.start && overflow.end && "chat-tab-fade-end",
        )}
      >
        {children}
      </div>
      <ChatTabScrollChevron
        side="start"
        visible={overflow.start}
        onClick={() => scrollByStep(-1)}
      />
      <ChatTabScrollChevron side="end" visible={overflow.end} onClick={() => scrollByStep(1)} />
    </div>
  );
}

/** A subtle, edge-docked scroll affordance that fades in only when scrollable. */
function ChatTabScrollChevron({
  side,
  visible,
  onClick,
}: {
  side: "start" | "end";
  visible: boolean;
  onClick(): void;
}): React.ReactElement {
  const Icon = side === "start" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
      aria-label={side === "start" ? "Scroll tabs left" : "Scroll tabs right"}
      onClick={onClick}
      onPointerDown={(event) => event.preventDefault()}
      className={cn(
        "absolute top-1/2 z-10 flex size-6 -translate-y-1/2 items-center justify-center rounded-full border border-hairline bg-bg-elev/90 text-fg-dim shadow-sm shadow-black/20 backdrop-blur-sm transition-[opacity,transform,color,background-color] duration-150 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        side === "start" ? "left-0" : "right-0",
        visible
          ? "pointer-events-auto opacity-100"
          : cn(
              "pointer-events-none opacity-0",
              side === "start" ? "-translate-x-1" : "translate-x-1",
            ),
      )}
    >
      <Icon size={14} strokeWidth={2} />
    </button>
  );
}

const CHAT_TAB_WIDTH_CLASS = "w-32 sm:w-44 md:w-52";
const RESTRICT_CHAT_TAB_DRAG_TO_HORIZONTAL: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
});
const CHAT_TAB_DRAG_MODIFIERS = [RESTRICT_CHAT_TAB_DRAG_TO_HORIZONTAL];

/** Shared styling for the small icon buttons docked at the right edge of a tab. */
const CHAT_TAB_ACTION_BUTTON_CLASS =
  "flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-mute transition-[opacity,color,background-color] duration-150 hover:bg-surface-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40";
/** Hover/focus reveal for the rename and drag-handle buttons (close stays visible when active). */
const CHAT_TAB_ACTION_REVEAL_CLASS =
  "opacity-0 group-hover/tab:opacity-100 group-focus-within/tab:opacity-100";

function ChatPinnedTabButton({
  tab,
  active,
  session,
  onSelect,
  onClose,
  onRename,
  onDelete,
}: {
  tab: ChatPinnedTab;
  active: boolean;
  session: ChatSessionSummary | null;
  onSelect(): void;
  onClose(): void;
  onRename(title: string): Promise<void>;
  onDelete?: (() => Promise<void>) | undefined;
}): React.ReactElement {
  const snapshotTitle = tab.titleSnapshot.trim();
  const title =
    snapshotTitle === ""
      ? session === null
        ? tab.key
        : sanitizeDisplayText(session.title)
      : snapshotTitle;
  // The not-yet-persisted "New session" placeholder has no server row, so
  // rename/delete don't apply; only drag + close are offered.
  const isPlaceholder = tab.sessionId === null;
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = onDelete !== undefined && session !== null && session.status !== "running";
  const inputRef = useRef<HTMLInputElement | null>(null);
  const commitInFlightRef = useRef(false);
  const cancelNextBlurRef = useRef(false);
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: tab.key,
    disabled: editing,
  });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  useEffect(() => {
    if (!editing) {
      setDraftTitle(title);
    }
  }, [editing, title]);

  useEffect(() => {
    if (editing) {
      window.requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  const startRename = useCallback(() => {
    setRenameError(null);
    setEditing(true);
  }, []);

  const beginEditing = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      startRename();
    },
    [startRename],
  );

  const handleConfirmOpenChange = useCallback(
    (next: boolean) => {
      if (deleting) {
        return;
      }
      setConfirmOpen(next);
      if (!next) {
        setDeleteError(null);
      }
    },
    [deleting],
  );

  const confirmDelete = useCallback(() => {
    if (onDelete === undefined || !canDelete || deleting) {
      return;
    }
    setDeleting(true);
    setDeleteError(null);
    void onDelete().then(
      () => {
        // The pinned tab is removed on success, unmounting this component;
        // these resets are harmless if it is already gone.
        setDeleting(false);
        setConfirmOpen(false);
      },
      (cause: unknown) => {
        setDeleteError(cause instanceof Error ? cause.message : String(cause));
        setDeleting(false);
      },
    );
  }, [canDelete, deleting, onDelete]);

  const cancelEditing = useCallback(() => {
    cancelNextBlurRef.current = true;
    setDraftTitle(title);
    setRenameError(null);
    setEditing(false);
  }, [title]);

  const commitEditing = useCallback(async () => {
    if (commitInFlightRef.current) {
      return;
    }
    const nextTitle = draftTitle.trim().replace(/\s+/g, " ");
    if (nextTitle === "") {
      setRenameError("Title is required.");
      inputRef.current?.focus();
      return;
    }
    if (nextTitle === title) {
      setEditing(false);
      setRenameError(null);
      return;
    }
    commitInFlightRef.current = true;
    setSaving(true);
    setRenameError(null);
    try {
      await onRename(nextTitle);
      setEditing(false);
    } catch (cause: unknown) {
      setRenameError(cause instanceof Error ? cause.message : String(cause));
      inputRef.current?.focus();
    } finally {
      commitInFlightRef.current = false;
      setSaving(false);
    }
  }, [draftTitle, onRename, title]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "group/tab flex h-8 shrink-0 touch-none items-center gap-1 rounded-md py-0 pr-2 pl-3 text-xs transition-[background-color,color,opacity,box-shadow] duration-150",
        CHAT_TAB_WIDTH_CLASS,
        active
          ? "bg-fg/[0.05] text-fg"
          : "bg-transparent text-fg-dim hover:bg-fg/[0.03] hover:text-fg active:opacity-70",
        isDragging && "z-10 opacity-80 shadow-lg shadow-black/30",
        renameError !== null && "bg-bad/[0.08] text-bad",
      )}
      title={renameError ?? undefined}
    >
      {editing ? (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {session === null ? (
            <Circle aria-hidden="true" size={8} strokeWidth={2} className="shrink-0 text-fg-mute" />
          ) : (
            <SessionStatusDot session={session} className="size-1.5" />
          )}
          <input
            ref={inputRef}
            value={draftTitle}
            disabled={saving}
            aria-label="Rename chat tab"
            onChange={(event) => setDraftTitle(event.currentTarget.value)}
            onBlur={() => {
              if (cancelNextBlurRef.current) {
                cancelNextBlurRef.current = false;
                return;
              }
              void commitEditing();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void commitEditing();
              } else if (event.key === "Escape") {
                event.preventDefault();
                cancelEditing();
              }
            }}
            onClick={(event) => event.stopPropagation()}
            onDoubleClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 bg-transparent text-xs text-fg outline-none selection:bg-selection/30 disabled:opacity-60"
          />
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Leading slot: status dot at rest, drag handle on hover/focus. */}
          <span className="relative flex size-4 shrink-0 items-center justify-center">
            <span
              aria-hidden="true"
              className="flex items-center justify-center transition-opacity duration-150 group-hover/tab:opacity-0 group-focus-within/tab:opacity-0"
            >
              {session === null ? (
                <Circle size={8} strokeWidth={2} className="text-fg-mute" />
              ) : (
                <SessionStatusDot session={session} className="size-1.5" />
              )}
            </span>
            <button
              type="button"
              aria-label={`Reorder ${title}`}
              title="Drag to reorder"
              disabled={saving}
              onClick={(event) => event.stopPropagation()}
              className="absolute inset-0 flex cursor-grab items-center justify-center rounded text-fg-mute opacity-0 transition-opacity duration-150 hover:text-fg focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing disabled:pointer-events-none group-hover/tab:opacity-100 group-focus-within/tab:opacity-100"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={12} strokeWidth={1.75} />
            </button>
          </span>
          <ChatTabPromptHoverCard prompt={session?.firstPrompt ?? null}>
            <button
              type="button"
              onClick={onSelect}
              onDoubleClick={isPlaceholder ? undefined : beginEditing}
              className="flex min-w-0 flex-1 cursor-default items-center text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="truncate">{title}</span>
            </button>
          </ChatTabPromptHoverCard>
        </div>
      )}
      {editing || isPlaceholder ? null : (
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`${title} options`}
              title="Tab options"
              disabled={saving}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                CHAT_TAB_ACTION_BUTTON_CLASS,
                menuOpen ? "opacity-100" : CHAT_TAB_ACTION_REVEAL_CLASS,
              )}
            >
              <MoreHorizontal size={12} strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 border-hairline bg-bg-elev text-fg">
            <DropdownMenuItem
              onSelect={(event) => {
                event.preventDefault();
                setMenuOpen(false);
                startRename();
              }}
              className="gap-2 text-xs"
            >
              <PencilLine size={13} strokeWidth={1.75} />
              Rename
            </DropdownMenuItem>
            {onDelete === undefined ? null : (
              <DropdownMenuItem
                disabled={!canDelete}
                onSelect={(event) => {
                  event.preventDefault();
                  setMenuOpen(false);
                  setConfirmOpen(true);
                }}
                className="gap-2 text-xs text-bad focus:bg-bad/10 focus:text-bad"
              >
                <Trash2 size={13} strokeWidth={1.75} />
                Delete
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button
        type="button"
        aria-label={`Close ${title}`}
        title="Close tab"
        disabled={saving}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
        onPointerDown={(event) => event.stopPropagation()}
        className={cn(
          CHAT_TAB_ACTION_BUTTON_CLASS,
          active || editing || menuOpen ? "opacity-100" : CHAT_TAB_ACTION_REVEAL_CLASS,
        )}
      >
        <X size={12} strokeWidth={1.75} />
      </button>
      {onDelete === undefined ? null : (
        <Dialog open={confirmOpen} onOpenChange={handleConfirmOpenChange}>
          <DialogContent className="max-w-sm border-hairline bg-bg-elev p-4 text-fg">
            <DialogHeader className="sr-only">
              <DialogTitle>Delete session?</DialogTitle>
              <DialogDescription>This permanently removes the chat session.</DialogDescription>
            </DialogHeader>
            <ChatSessionDeleteConfirm
              title={title}
              deleting={deleting}
              error={deleteError}
              onCancel={() => handleConfirmOpenChange(false)}
              onConfirm={confirmDelete}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** Max characters of the original prompt shown in a tab hover card. */
const CHAT_TAB_PROMPT_PREVIEW_LIMIT = 280;

function truncatePromptPreview(prompt: string, limit = CHAT_TAB_PROMPT_PREVIEW_LIMIT): string {
  const collapsed = prompt.replace(/\s+/g, " ").trim();
  if (collapsed.length <= limit) {
    return collapsed;
  }
  return `${collapsed.slice(0, limit).trimEnd()}\u2026`;
}

/**
 * Wraps a tab's title button so hovering reveals the original prompt that
 * started the session, truncated when long. Sessions without a stored prompt
 * (e.g. a brand-new tab) render the trigger without a hover card.
 */
function ChatTabPromptHoverCard({
  prompt,
  children,
}: {
  prompt: string | null;
  children: React.ReactNode;
}): React.ReactElement {
  const preview = prompt === null ? "" : truncatePromptPreview(prompt);
  if (preview === "") {
    return <>{children}</>;
  }
  return (
    <HoverCard openDelay={400} closeDelay={120}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent align="start" side="bottom" className="w-80 max-w-[min(24rem,90vw)] p-3">
        <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-fg-dim">
          {preview}
        </p>
      </HoverCardContent>
    </HoverCard>
  );
}

function InlineChatEmptyState(): React.ReactElement {
  return (
    <Empty className="min-h-[280px] border-0 bg-transparent px-4 py-10 text-center">
      <EmptyHeader>
        <EmptyMedia className="mb-1 text-fg-mute">
          <MessageSquare size={14} strokeWidth={1.75} />
        </EmptyMedia>
        <EmptyTitle className="text-sm font-medium tracking-tight text-fg">Ready.</EmptyTitle>
        <EmptyDescription className="text-xs leading-normal text-fg-mute">
          Start a new chat below, or use <KeyboardShortcut>⌘K</KeyboardShortcut> to open the session
          picker.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

function LoadOlderMessagesButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick(): void;
}): React.ReactElement {
  return (
    <div className="flex justify-center pb-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={loading}
        onClick={onClick}
        className="h-7 rounded-md border-hairline bg-bg-elev px-2.5 text-xs text-fg-dim hover:bg-surface-2 hover:text-fg"
      >
        {loading ? <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin" /> : null}
        Load older
      </Button>
    </div>
  );
}

function KeyboardShortcut({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <kbd className="whitespace-nowrap rounded border border-hairline px-1 py-px font-mono text-2xs leading-none tracking-tight text-fg-mute">
      {children}
    </kbd>
  );
}

function ChatPromptHeader({
  queuedMessages,
  onSteerQueuedMessage,
  onRemoveQueuedMessage,
  onReorderQueuedMessage,
}: {
  queuedMessages: QueuedChatMessage[];
  onSteerQueuedMessage(id: string): void;
  onRemoveQueuedMessage(id: string): void;
  onReorderQueuedMessage(id: string, beforeId: string | null): void;
}): React.ReactElement | null {
  const attachments = usePromptInputAttachments();
  if (queuedMessages.length === 0 && attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader className="flex-col items-stretch gap-2">
      {queuedMessages.length === 0 ? null : (
        <QueuedPromptMessages
          messages={queuedMessages}
          onRemoveMessage={onRemoveQueuedMessage}
          onReorderMessage={onReorderQueuedMessage}
          onSteerMessage={onSteerQueuedMessage}
        />
      )}
      {attachments.files.length === 0 ? null : (
        <Attachments variant="grid" className="ml-0 self-start">
          {attachments.files.map((attachment) => (
            <Attachment
              key={attachment.id}
              data={attachment}
              onRemove={() => attachments.remove(attachment.id)}
            >
              <AttachmentPreview />
              <AttachmentRemove />
            </Attachment>
          ))}
        </Attachments>
      )}
    </PromptInputHeader>
  );
}

function QueuedPromptMessages({
  messages,
  onRemoveMessage,
  onReorderMessage,
  onSteerMessage,
}: {
  messages: QueuedChatMessage[];
  onRemoveMessage(id: string): void;
  onReorderMessage(id: string, beforeId: string | null): void;
  onSteerMessage(id: string): void;
}): React.ReactElement {
  const itemIds = useMemo(() => messages.map((message) => message.id), [messages]);
  const dragSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const activeId = String(event.active.id);
      const overId = event.over?.id;
      if (overId === undefined || activeId === String(overId)) {
        return;
      }
      const newIndex = itemIds.indexOf(String(overId));
      if (newIndex === -1) {
        return;
      }
      const remainingIds = itemIds.filter((id) => id !== activeId);
      onReorderMessage(activeId, remainingIds[newIndex] ?? null);
    },
    [itemIds, onReorderMessage],
  );
  return (
    <Queue className="w-full rounded-md border-hairline bg-transparent px-2 py-1.5 shadow-none">
      <QueueSection defaultOpen>
        <QueueSectionTrigger className="bg-transparent px-1.5 py-1 text-xs font-medium text-fg-mute hover:bg-surface-2">
          <QueueSectionLabel count={messages.length} label="Queued" />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <DndContext
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
            sensors={dragSensors}
          >
            <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
              <QueueList className="mt-1 -mb-0">
                {messages.map((message) => (
                  <QueuedPromptMessage
                    key={message.id}
                    message={message}
                    onRemove={() => onRemoveMessage(message.id)}
                    onSteer={() => onSteerMessage(message.id)}
                  />
                ))}
              </QueueList>
            </SortableContext>
          </DndContext>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
}

function QueuedPromptMessage({
  message,
  onRemove,
  onSteer,
}: {
  message: QueuedChatMessage;
  onRemove(): void;
  onSteer(): void;
}): React.ReactElement {
  const description = queuedChatMessageDescription(message);
  const { attributes, isDragging, listeners, setNodeRef, transform, transition } = useSortable({
    id: message.id,
  });
  return (
    <QueueItem
      ref={setNodeRef}
      className={cn(
        "px-1.5 py-1.5 text-xs hover:bg-surface-2",
        isDragging && "relative z-10 bg-surface-2 shadow-sm",
      )}
      style={{ transform: CSS.Transform.toString(transform), transition }}
    >
      <div className="flex min-w-0 items-start gap-2">
        <QueueItemAction
          aria-label="Reorder queued message"
          className="mt-0.5 cursor-grab touch-none opacity-100 [&>svg]:!size-3 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={12} strokeWidth={1.75} />
        </QueueItemAction>
        <QueueItemIndicator className="mt-[0.45rem] size-2 shrink-0 border-fg-mute/60" />
        <QueueItemContent className="min-w-0 text-xs leading-5 text-fg">
          {queuedChatMessageLabel(message)}
        </QueueItemContent>
        <QueueItemActions className="ml-auto shrink-0">
          <QueueItemAction
            aria-label="Steer the active run with this queued message"
            className="px-1.5 text-2xs opacity-100"
            onClick={onSteer}
            title="Move into the transcript and steer the active run"
          >
            Steer
          </QueueItemAction>
          <QueueItemAction
            aria-label="Remove queued message"
            className="opacity-100 [&>svg]:!size-3"
            onClick={onRemove}
          >
            <X size={12} strokeWidth={1.75} />
          </QueueItemAction>
        </QueueItemActions>
      </div>
      <QueueItemDescription className="ml-12 text-xs leading-4 text-fg-mute">
        {description}
      </QueueItemDescription>
      {message.attachments.length === 0 ? null : (
        <QueueItemAttachment className="ml-12 mt-1 gap-1.5">
          {message.attachments.map((attachment) => (
            <QueuedPromptAttachment key={attachment.id} attachment={attachment} />
          ))}
        </QueueItemAttachment>
      )}
    </QueueItem>
  );
}

function QueuedPromptAttachment({
  attachment,
}: {
  attachment: AttachmentData;
}): React.ReactElement {
  const label = getAttachmentLabel(attachment);
  if (
    attachment.type === "file" &&
    getMediaCategory(attachment) === "image" &&
    attachment.url !== ""
  ) {
    return (
      <QueueItemImage
        alt={label}
        className="size-7 rounded-sm border-hairline"
        src={attachment.url}
      />
    );
  }

  return <QueueItemFile className="border-hairline bg-surface text-xs">{label}</QueueItemFile>;
}

function ChatPromptSubmit({
  prompt,
  runState,
  externallyRunning,
  compacting,
  onStop,
}: {
  prompt: string;
  runState: ChatRunState;
  externallyRunning: boolean;
  compacting: boolean;
  onStop(): void;
}): React.ReactElement {
  const attachments = usePromptInputAttachments();
  const submitState = chatComposerSubmitState({
    prompt,
    attachmentCount: attachments.files.length,
    runState,
    externallyRunning,
    compacting,
  });
  return (
    <PromptInputSubmit
      disabled={submitState.disabled}
      onStop={onStop}
      className="size-7 [&>svg]:!size-3.5"
      {...(submitState.status ? { status: submitState.status } : {})}
    />
  );
}

const TranscriptMessage = memo(function TranscriptMessage({
  message,
  sessionId,
}: {
  message: ChatMessageView;
  sessionId: string | null;
}): React.ReactElement {
  const showActions =
    (message.role === "assistant" || message.role === "user") &&
    message.status === "complete" &&
    message.content !== "";
  const showUsage =
    message.role === "assistant" && message.status === "complete" && message.usage !== undefined;
  return (
    <Message
      from={message.role}
      status={message.status}
      className="[content-visibility:auto] [contain-intrinsic-size:96px]"
    >
      <div
        className={cn(
          "flex min-w-0 max-w-[min(820px,100%)] flex-1 flex-col",
          message.role === "user" && "items-end",
        )}
      >
        {message.attachments !== undefined && message.attachments.length > 0 ? (
          <Attachments variant="grid" className="ml-0 mb-2 self-start">
            {message.attachments.map((attachment) => (
              <Attachment key={attachment.id} data={attachment}>
                <AttachmentPreview />
              </Attachment>
            ))}
          </Attachments>
        ) : null}
        {message.role === "assistant" &&
        message.reasoning !== undefined &&
        message.reasoning !== "" ? (
          <Reasoning isStreaming={message.status === "streaming"}>
            <ReasoningTrigger />
            <ReasoningContent>{message.reasoning}</ReasoningContent>
          </Reasoning>
        ) : null}
        {message.content === "" ? null : (
          <MessageContent
            className={cn(
              message.role === "system" &&
                message.systemKind === "status" &&
                "font-mono text-xs leading-5 text-fg-mute",
              message.role === "system" &&
                message.systemKind === "summary" &&
                "border-l border-hairline-strong pl-3 text-fg",
            )}
          >
            {message.role === "assistant" || message.systemKind === "summary" ? (
              <MessageResponse>{message.content}</MessageResponse>
            ) : (
              message.content
            )}
          </MessageContent>
        )}
        {message.pendingKind === "steering" ? (
          <div className="mt-1 text-2xs leading-4 text-fg-mute">Steering when Strata is ready…</div>
        ) : null}
        {message.toolCalls.length === 0 ? null : (
          <div className="mt-2 flex w-full flex-col gap-2">
            {message.toolCalls.map((tool) => (
              <ToolPanel key={tool.id} tool={tool} sessionId={sessionId} />
            ))}
          </div>
        )}
        {showActions ? (
          <MessageActions>
            <CopyMessageAction text={message.content} />
            {showUsage && message.usage !== undefined ? (
              <MessageUsageBadge usage={message.usage} />
            ) : null}
          </MessageActions>
        ) : null}
      </div>
    </Message>
  );
});

function MessageUsageBadge({ usage }: { usage: TokenUsage }): React.ReactElement | null {
  if (usage.input === 0 && usage.output === 0 && usage.cacheRead === 0 && usage.cacheWrite === 0) {
    return null;
  }
  const parts: string[] = [];
  if (usage.input > 0) parts.push(`${formatTokens(usage.input)} in`);
  if (usage.output > 0) parts.push(`${formatTokens(usage.output)} out`);
  if (usage.cacheRead > 0) parts.push(`${formatTokens(usage.cacheRead)} read`);
  if (usage.cacheWrite > 0) parts.push(`${formatTokens(usage.cacheWrite)} write`);
  if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(3)}`);
  const compact = parts.join(" · ");
  const full = `Input: ${formatTokens(usage.input)} · Output: ${formatTokens(
    usage.output,
  )} · Cache read: ${formatTokens(usage.cacheRead)} · Cache write: ${formatTokens(
    usage.cacheWrite,
  )} · Total: ${formatTokens(usage.total)}${usage.cost > 0 ? ` · Cost: $${usage.cost.toFixed(4)}` : ""}`;
  return (
    <span
      title={full}
      className="ml-1 inline-flex items-center gap-1 font-mono text-2xs leading-4 text-fg-mute"
    >
      {compact}
    </span>
  );
}

function CopyMessageAction({ text }: { text: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [text]);
  return (
    <MessageAction label={copied ? "Copied" : "Copy message"} onClick={handleCopy}>
      {copied ? (
        <Check size={13} strokeWidth={1.75} className="text-good" />
      ) : (
        <Copy size={13} strokeWidth={1.75} />
      )}
    </MessageAction>
  );
}

const ToolPanel = memo(function ToolPanel({
  tool,
  sessionId,
}: {
  tool: ChatToolCallView;
  sessionId: string | null;
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [loadedResult, setLoadedResult] = useState<{
    result: unknown;
    status: ChatToolCallView["status"];
    summary: string | null;
  } | null>(null);
  const [loadingResult, setLoadingResult] = useState(false);
  const [resultError, setResultError] = useState<string | null>(null);

  useEffect(() => {
    if (
      !open ||
      sessionId === null ||
      !tool.resultAvailable ||
      tool.result !== undefined ||
      loadedResult !== null
    ) {
      return;
    }
    let cancelled = false;
    setLoadingResult(true);
    setResultError(null);
    void getChatToolResult(sessionId, tool.id).then(
      (detail) => {
        if (cancelled) {
          return;
        }
        setLoadingResult(false);
        if (detail === null) {
          setResultError("Tool result is no longer available.");
          return;
        }
        setLoadedResult({
          result: parseJsonValue(detail.content),
          status: detail.status,
          summary: detail.summary,
        });
      },
      (cause: unknown) => {
        if (cancelled) {
          return;
        }
        setLoadingResult(false);
        setResultError(errorMessage(cause));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [loadedResult, open, sessionId, tool.id, tool.result, tool.resultAvailable]);

  const handleToggle = useCallback((event: React.SyntheticEvent<HTMLDetailsElement>) => {
    setOpen(event.currentTarget.open);
  }, []);

  const displayTool =
    loadedResult === null
      ? tool
      : {
          ...tool,
          status: loadedResult.status,
          ...(loadedResult.summary === null ? {} : { summary: loadedResult.summary }),
          result: loadedResult.result,
        };
  const args = parseToolArguments(displayTool.argumentsText);
  const execution = normalizeToolExecution(displayTool);
  const summary = displayTool.summary ?? toolSummary(displayTool, args, execution);

  return (
    <Tool status={displayTool.status} open={open} onToggle={handleToggle}>
      <ToolHeader>
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <ToolIcon name={displayTool.name} />
          <span className="shrink-0 whitespace-nowrap font-mono text-xs text-fg">
            {displayTool.name}
          </span>
          {summary === null ? null : (
            <span className="hidden min-w-0 truncate text-xs text-fg-mute sm:inline">
              {summary}
            </span>
          )}
        </span>
        <span
          className={cn(
            "label-eyebrow ml-auto",
            displayTool.status === "running" && "!text-warn",
            displayTool.status === "complete" && "!text-good",
            displayTool.status === "error" && "!text-bad",
          )}
        >
          {displayTool.status}
        </span>
      </ToolHeader>
      {open ? (
        <ToolContent>
          {loadingResult ? (
            <p className="text-xs text-fg-mute">Loading result...</p>
          ) : resultError === null ? (
            <SpecializedToolContent tool={displayTool} args={args} execution={execution} />
          ) : (
            <p className="text-xs text-bad">{resultError}</p>
          )}
        </ToolContent>
      ) : null}
    </Tool>
  );
});

function ToolIcon({ name }: { name: string }): React.ReactElement {
  const className = "shrink-0 text-accent";
  if (name === "shell.run") {
    return <TerminalIcon size={13} strokeWidth={1.75} className={className} />;
  }
  if (name === "wiki.search" || name === "fs.grep" || name === "sessions.search") {
    return <Search size={13} strokeWidth={1.75} className={className} />;
  }
  if (name === "fs.edit" || name === "wiki.patchPage") {
    return <PencilLine size={13} strokeWidth={1.75} className={className} />;
  }
  if (name === "fs.read" || name === "wiki.readPage") {
    return <FileText size={13} strokeWidth={1.75} className={className} />;
  }
  if (name.startsWith("memory.")) {
    return <Brain size={13} strokeWidth={1.75} className={className} />;
  }
  if (name.startsWith("todo.")) {
    return <ListTodo size={13} strokeWidth={1.75} className={className} />;
  }
  if (name.startsWith("skills.")) {
    return <BookOpen size={13} strokeWidth={1.75} className={className} />;
  }
  return <Wrench size={13} strokeWidth={1.75} className={className} />;
}

function SpecializedToolContent({
  tool,
  args,
  execution,
}: {
  tool: ChatToolCallView;
  args: JsonRecord | null;
  execution: ToolExecutionView | null;
}): React.ReactElement {
  if (tool.status === "running" && execution === null) {
    if (tool.name === "shell.run") {
      return <RunningShellView tool={tool} args={args} />;
    }
    return <PreviewBlock label="args" value={formatArguments(tool.argumentsText)} />;
  }
  if (execution?.ok === false) {
    return <ToolErrorView execution={execution} argsText={tool.argumentsText} />;
  }
  const result = execution?.ok === true ? execution.result : undefined;
  const resultTruncated = execution?.ok === true ? execution.truncated : false;

  if (tool.name === "wiki.search" && isRecord(result)) {
    return <SearchToolView args={args} result={result} truncated={resultTruncated} />;
  }
  if ((tool.name === "wiki.readPage" || tool.name === "fs.read") && isRecord(result)) {
    return <ReadToolView args={args} result={result} truncated={resultTruncated} />;
  }
  if ((tool.name === "fs.edit" || tool.name === "wiki.patchPage") && isRecord(result)) {
    return <EditToolView args={args} result={result} truncated={resultTruncated} />;
  }
  if (tool.name === "shell.run" && isRecord(result)) {
    return <ShellToolView args={args} result={result} truncated={resultTruncated} />;
  }
  if ((tool.name === "memory.write" || tool.name === "memory.append") && isRecord(result)) {
    return <MemoryToolView toolName={tool.name} args={args} result={result} />;
  }
  if (
    (tool.name === "todo.add" || tool.name === "todo.update" || tool.name === "todo.remove") &&
    isRecord(result)
  ) {
    return <TodoToolView toolName={tool.name} args={args} result={result} />;
  }
  if (tool.name === "skills.list" && isRecord(result)) {
    return <SkillsListToolView result={result} truncated={resultTruncated} />;
  }
  if (tool.name === "skills.read" && isRecord(result)) {
    return <SkillsReadToolView args={args} result={result} truncated={resultTruncated} />;
  }

  const argsPreview = formatArguments(tool.argumentsText);
  const resultPreview = tool.result === undefined ? null : formatValue(tool.result);

  return (
    <div className="space-y-2">
      <PreviewBlock label="args" value={argsPreview} />
      {resultPreview === null ? null : <PreviewBlock label="result" value={resultPreview} />}
    </div>
  );
}

function ToolErrorView({
  execution,
  argsText,
}: {
  execution: Extract<ToolExecutionView, { ok: false }>;
  argsText: string;
}): React.ReactElement {
  return (
    <div className="space-y-2">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,0.45fr)_minmax(0,1fr)]">
        <ToolMetric label="code" value={execution.error.code} tone="bad" />
        <ToolMetric label="message" value={execution.error.message} tone="bad" />
      </div>
      <PreviewBlock label="args" value={formatArguments(argsText)} />
    </div>
  );
}

function SearchToolView({
  args,
  result,
  truncated,
}: {
  args: JsonRecord | null;
  result: JsonRecord;
  truncated: boolean;
}): React.ReactElement {
  const query = stringValue(result.query) ?? stringValue(args?.query) ?? "";
  const matches = arrayValue(result.matches);
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="query" value={query || "(empty)"} />
        <ToolMetric
          label="matches"
          value={numberValue(result.count)?.toString() ?? matches.length.toString()}
        />
        <ToolMetric
          label="truncated"
          value={truncated || booleanValue(result.truncated) ? "yes" : "no"}
        />
      </ToolMetricGrid>
      {matches.length === 0 ? (
        <p className="text-xs text-fg-mute">No matches returned.</p>
      ) : (
        <div className="overflow-hidden border border-hairline">
          {matches.slice(0, 8).map((entry, index) => (
            <SearchMatchRow key={searchMatchKey(entry, index)} entry={entry} />
          ))}
          {matches.length > 8 ? (
            <div className="border-t border-hairline px-2 py-1.5 text-xs text-fg-mute">
              {matches.length - 8} more match(es) omitted from the panel.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SearchMatchRow({ entry }: { entry: unknown }): React.ReactElement {
  const record = isRecord(entry) ? entry : {};
  const path = stringValue(record.path) ?? "(unknown)";
  const line = numberValue(record.line);
  const preview = stringValue(record.preview) ?? formatValue(entry);
  return (
    <div className="border-t border-hairline px-2 py-2 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-xs text-fg">{path}</span>
        {line === null ? null : (
          <span className="shrink-0 font-mono text-xs text-fg-mute">:{line}</span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-dim">{preview}</p>
    </div>
  );
}

function ReadToolView({
  args,
  result,
  truncated,
}: {
  args: JsonRecord | null;
  result: JsonRecord;
  truncated: boolean;
}): React.ReactElement {
  const path = stringValue(result.path) ?? stringValue(args?.path) ?? "(unknown)";
  const content = stringValue(result.content) ?? "";
  const firstLine = numberValue(result.firstLine);
  const lastLine = numberValue(result.lastLine);
  const lineRange = firstLine === null || lastLine === null ? null : `${firstLine}-${lastLine}`;
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="path" value={path} />
        <ToolMetric
          label="chars"
          value={numberValue(result.chars)?.toString() ?? content.length.toString()}
        />
        <ToolMetric
          label="lines"
          value={lineRange ?? numberValue(result.totalLines)?.toString() ?? "n/a"}
        />
        <ToolMetric
          label="truncated"
          value={truncated || booleanValue(result.truncated) ? "yes" : "no"}
        />
      </ToolMetricGrid>
      <PreviewBlock label="content" value={clipPreview(content, 1800)} />
    </div>
  );
}

function EditToolView({
  args,
  result,
  truncated,
}: {
  args: JsonRecord | null;
  result: JsonRecord;
  truncated: boolean;
}): React.ReactElement {
  const path = stringValue(result.path) ?? stringValue(args?.path) ?? "(unknown)";
  const repoPath = stringValue(result.repoPath);
  const diff = stringValue(result.diff) ?? "";
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="path" value={path} />
        {repoPath === null ? null : <ToolMetric label="repo path" value={repoPath} />}
        <ToolMetric
          label="replacements"
          value={numberValue(result.replacements)?.toString() ?? "n/a"}
        />
        <ToolMetric label="bytes" value={numberValue(result.bytes)?.toString() ?? "n/a"} />
        <ToolMetric
          label="truncated"
          value={truncated || booleanValue(result.truncated) ? "yes" : "no"}
        />
      </ToolMetricGrid>
      {diff === "" ? (
        <PreviewBlock label="result" value={formatValue(result)} />
      ) : (
        <PreviewBlock label="diff" value={clipPreview(diff, 2400)} />
      )}
    </div>
  );
}

function ShellToolView({
  args,
  result,
  truncated,
}: {
  args: JsonRecord | null;
  result: JsonRecord;
  truncated: boolean;
}): React.ReactElement {
  const command = stringValue(result.command) ?? stringValue(args?.command) ?? "";
  const cwd = stringValue(result.cwd) ?? stringValue(args?.cwd) ?? ".";
  const exitCode = numberValue(result.exitCode);
  const timedOut = booleanValue(result.timedOut);
  const stdout = outputText(result.stdout);
  const stderr = outputText(result.stderr);
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric
          label="exit"
          value={exitCode === null ? "n/a" : exitCode.toString()}
          tone={exitCode === 0 ? "good" : "bad"}
        />
        <ToolMetric label="duration" value={formatDuration(numberValue(result.durationMs))} />
        <ToolMetric
          label="timed out"
          value={timedOut ? "yes" : "no"}
          tone={timedOut ? "bad" : "default"}
        />
        <ToolMetric
          label="truncated"
          value={truncated || stdout.truncated || stderr.truncated ? "yes" : "no"}
          tone={truncated || stdout.truncated || stderr.truncated ? "bad" : "default"}
        />
      </ToolMetricGrid>
      <PreviewBlock label="command" value={command} />
      <ToolMetric label="cwd" value={cwd} />
      {stdout.text === "" ? null : (
        <ShellOutputTerminal label="stdout" output={stdout.text} truncated={stdout.truncated} />
      )}
      {stderr.text === "" ? null : (
        <ShellOutputTerminal label="stderr" output={stderr.text} truncated={stderr.truncated} />
      )}
      {stdout.text === "" && stderr.text === "" ? (
        <p className="text-xs text-fg-mute">No stdout or stderr output.</p>
      ) : null}
    </div>
  );
}

function ShellOutputTerminal({
  label,
  output,
  truncated,
  streaming = false,
}: {
  label: "stdout" | "stderr";
  output: string;
  truncated: boolean;
  streaming?: boolean;
}): React.ReactElement {
  return (
    <TerminalOutput
      autoScroll={streaming}
      isStreaming={streaming}
      output={output}
      className="rounded-md border-hairline bg-zinc-950 text-zinc-100"
    >
      <TerminalHeader className="border-zinc-800 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalTitle>{label}</TerminalTitle>
          {truncated ? (
            <span className="font-mono text-2xs leading-4 text-bad">truncated</span>
          ) : null}
        </div>
        <TerminalActions>
          <TerminalCopyButton aria-label={`Copy ${label}`} title={`Copy ${label}`} />
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-80 p-3" />
    </TerminalOutput>
  );
}

/** Live view for an in-flight shell.run: args plus streaming stdout/stderr. */
function RunningShellView({
  tool,
  args,
}: {
  tool: ChatToolCallView;
  args: JsonRecord | null;
}): React.ReactElement {
  const command = stringValue(args?.command) ?? "";
  const stdout = tool.liveOutput?.stdout ?? "";
  const stderr = tool.liveOutput?.stderr ?? "";
  return (
    <div className="space-y-2">
      {command === "" ? null : <PreviewBlock label="command" value={command} />}
      {stdout === "" ? null : (
        <ShellOutputTerminal label="stdout" output={stdout} truncated={false} streaming />
      )}
      {stderr === "" ? null : (
        <ShellOutputTerminal label="stderr" output={stderr} truncated={false} streaming />
      )}
      {stdout === "" && stderr === "" ? <p className="text-xs text-fg-mute">Running…</p> : null}
    </div>
  );
}

function MemoryToolView({
  toolName,
  args,
  result,
}: {
  toolName: string;
  args: JsonRecord | null;
  result: JsonRecord;
}): React.ReactElement {
  const document = recordValue(result.document);
  const target = stringValue(document?.target) ?? stringValue(args?.target) ?? "memory";
  const path = stringValue(document?.path) ?? "";
  const chars = numberValue(document?.chars);
  const entry = stringValue(args?.entry);
  const content = entry ?? stringValue(document?.content) ?? "";
  const truncated = booleanValue(document?.truncated);
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="target" value={target} />
        <ToolMetric label="path" value={path || "n/a"} />
        <ToolMetric label="chars" value={chars === null ? "n/a" : chars.toString()} />
        <ToolMetric label="truncated" value={truncated ? "yes" : "no"} />
      </ToolMetricGrid>
      {content === "" ? null : (
        <PreviewBlock
          label={toolName === "memory.append" ? "entry" : "content"}
          value={clipPreview(content, 1800)}
        />
      )}
    </div>
  );
}

function TodoToolView({
  toolName,
  args,
  result,
}: {
  toolName: string;
  args: JsonRecord | null;
  result: JsonRecord;
}): React.ReactElement {
  const item = recordValue(result.item) ?? recordValue(result.removed) ?? {};
  const id = stringValue(item.id) ?? stringValue(args?.id) ?? "";
  const title = stringValue(item.title) ?? stringValue(args?.title) ?? "(untitled)";
  const status = stringValue(item.status) ?? "n/a";
  const priority = stringValue(item.priority) ?? "n/a";
  const due = stringValue(item.due) ?? "none";
  const tags = arrayStrings(item.tags).join(", ");
  const notes = stringValue(item.notes) ?? stringValue(args?.notes) ?? "";
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="action" value={toolName.slice("todo.".length)} />
        <ToolMetric label="status" value={status} />
        <ToolMetric label="priority" value={priority} />
        <ToolMetric label="due" value={due} />
      </ToolMetricGrid>
      <ToolMetric label="title" value={title} />
      {id === "" ? null : <ToolMetric label="id" value={id} />}
      {tags === "" ? null : <ToolMetric label="tags" value={tags} />}
      {notes === "" ? null : <PreviewBlock label="notes" value={clipPreview(notes, 1200)} />}
    </div>
  );
}

function SkillsListToolView({
  result,
  truncated,
}: {
  result: JsonRecord;
  truncated: boolean;
}): React.ReactElement {
  const skills = arrayValue(result.skills);
  const count = numberValue(result.count) ?? skills.length;
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="skills" value={count.toString()} />
        <ToolMetric label="shown" value={skills.length.toString()} />
        <ToolMetric label="truncated" value={truncated ? "yes" : "no"} />
      </ToolMetricGrid>
      {skills.length === 0 ? (
        <p className="text-xs text-fg-mute">No skills returned.</p>
      ) : (
        <div className="overflow-hidden border border-hairline">
          {skills.slice(0, 10).map((entry, index) => (
            <SkillRow key={skillRowKey(entry, index)} entry={entry} />
          ))}
          {skills.length > 10 ? (
            <div className="border-t border-hairline px-2 py-1.5 text-xs text-fg-mute">
              {skills.length - 10} more skill(s) omitted from the panel.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function SkillsReadToolView({
  args,
  result,
  truncated,
}: {
  args: JsonRecord | null;
  result: JsonRecord;
  truncated: boolean;
}): React.ReactElement {
  const skill = recordValue(result.skill) ?? {};
  const metadata = recordValue(skill.metadata) ?? {};
  const name = stringValue(metadata.name) ?? stringValue(args?.name) ?? "(unknown)";
  const path = stringValue(metadata.path) ?? "";
  const source = stringValue(metadata.source) ?? "n/a";
  const chars = numberValue(skill.chars);
  const content = stringValue(skill.content) ?? "";
  const skillTruncated = truncated || booleanValue(skill.truncated);
  return (
    <div className="space-y-2">
      <ToolMetricGrid>
        <ToolMetric label="skill" value={name} />
        <ToolMetric label="source" value={source} />
        <ToolMetric label="chars" value={chars === null ? "n/a" : chars.toString()} />
        <ToolMetric label="truncated" value={skillTruncated ? "yes" : "no"} />
      </ToolMetricGrid>
      {path === "" ? null : <ToolMetric label="path" value={path} />}
      {content === "" ? null : <PreviewBlock label="skill" value={clipPreview(content, 2400)} />}
    </div>
  );
}

function SkillRow({ entry }: { entry: unknown }): React.ReactElement {
  const record = recordValue(entry) ?? {};
  const name = stringValue(record.name) ?? "(unknown)";
  const source = stringValue(record.source) ?? "n/a";
  const status = stringValue(record.status) ?? "";
  const description = stringValue(record.description) ?? "";
  return (
    <div className="border-t border-hairline px-2 py-2 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-xs text-fg">{name}</span>
        <span className="shrink-0 font-mono text-xs text-fg-mute">
          {source}
          {status === "" ? "" : `/${status}`}
        </span>
      </div>
      {description === "" ? null : (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-fg-dim">{description}</p>
      )}
    </div>
  );
}

function ToolMetricGrid({ children }: { children: React.ReactNode }): React.ReactElement {
  return <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{children}</div>;
}

function ToolMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "good" | "bad";
}): React.ReactElement {
  return (
    <div className="min-w-0 border border-hairline bg-surface px-2 py-1.5">
      <div className="label-eyebrow text-fg-mute">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate font-mono text-xs",
          tone === "good" && "text-good",
          tone === "bad" && "text-bad",
          tone === "default" && "text-fg",
        )}
        title={value}
      >
        {value}
      </div>
    </div>
  );
}

function PreviewBlock({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="min-w-0">
      <div className="label-eyebrow mb-1 text-fg-mute">{label}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-surface p-2 text-xs leading-5 text-fg-dim">
        {value}
      </pre>
    </div>
  );
}

function ContextUsageIndicator({
  usage,
  contextWindow,
}: {
  usage: TokenUsageTotals;
  contextWindow: number | undefined;
}): React.ReactElement | null {
  if (contextWindow === undefined || contextWindow <= 0) {
    return null;
  }
  const latestContextTokens = usage.latestContextTokens ?? 0;
  const usedTokens = Math.max(0, Math.min(latestContextTokens, contextWindow));
  const contextPercent = contextUsagePercent(latestContextTokens, contextWindow);
  const hasBreakdown =
    usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cacheWrite > 0;
  return (
    <Context maxTokens={contextWindow} usedTokens={usedTokens} usage={toLanguageModelUsage(usage)}>
      <ContextTrigger
        className={cn(
          "h-7 gap-1.5 rounded-md border border-hairline bg-surface px-2 py-0 font-mono text-xs",
          contextPercent !== undefined &&
            contextPercent > 70 &&
            "border-warn/45 text-warn hover:text-warn",
          contextPercent !== undefined &&
            contextPercent > 90 &&
            "border-bad/45 text-bad hover:text-bad",
        )}
      />
      <ContextContent align="end" className="w-72 border-hairline-strong bg-surface text-fg">
        <ContextContentHeader />
        {hasBreakdown ? (
          <ContextContentBody className="space-y-2">
            {usage.input > 0 ? (
              <ContextInputUsage>
                <ContextUsageRow label="Input" value={formatTokens(usage.input)} />
              </ContextInputUsage>
            ) : null}
            {usage.output > 0 ? (
              <ContextOutputUsage>
                <ContextUsageRow label="Output" value={formatTokens(usage.output)} />
              </ContextOutputUsage>
            ) : null}
            {usage.cacheRead > 0 ? (
              <ContextCacheUsage>
                <ContextUsageRow label="Cache read" value={formatTokens(usage.cacheRead)} />
              </ContextCacheUsage>
            ) : null}
            {usage.cacheWrite > 0 ? (
              <ContextUsageRow label="Cache write" value={formatTokens(usage.cacheWrite)} />
            ) : null}
          </ContextContentBody>
        ) : null}
        {usage.cost > 0 ? (
          <ContextContentFooter className="bg-surface-2">
            <span className="text-fg-mute">Total cost</span>
            <span>${usage.cost.toFixed(3)}</span>
          </ContextContentFooter>
        ) : null}
      </ContextContent>
    </Context>
  );
}

function ContextUsageRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 text-xs">
      <span className="text-fg-mute">{label}</span>
      <span className="font-mono text-fg">{value}</span>
    </div>
  );
}

function toLanguageModelUsage(usage: TokenUsageTotals): LanguageModelUsage {
  return {
    inputTokens: usage.input,
    inputTokenDetails: {
      noCacheTokens: usage.input,
      cacheReadTokens: usage.cacheRead,
      cacheWriteTokens: usage.cacheWrite,
    },
    outputTokens: usage.output,
    outputTokenDetails: {
      textTokens: usage.output,
      reasoningTokens: undefined,
    },
    totalTokens: usage.total,
    cachedInputTokens: usage.cacheRead,
  };
}

function RunStatusBadge({
  runState,
  externallyRunning,
  compacting,
  startedAt,
  turnSeed,
}: {
  runState: ChatRunState;
  externallyRunning: boolean;
  compacting: boolean;
  startedAt: string | null;
  turnSeed: string | null;
}): React.ReactElement | null {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const live = runState !== "idle" || externallyRunning || compacting;
  const startedMs = useMemo(() => timestampMs(startedAt), [startedAt]);
  const statusCycle =
    startedMs === null || !live ? 0 : Math.max(0, Math.floor((nowMs - startedMs) / 30_000));
  const label = useMemo(
    () => spinnerVerbForTurnCycle(turnSeed, statusCycle),
    [turnSeed, statusCycle],
  );

  useEffect(() => {
    if (!live) {
      return;
    }
    setNowMs(Date.now());
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [live, turnSeed]);

  const turnKey = startedAt ?? turnSeed ?? label;

  if (runState === "idle") {
    if (compacting) {
      return (
        <StreamingStatusPill
          label="compacting context"
          title="Summarizing this session to reset context"
          elapsed={null}
          typingKey="manual-compaction"
        />
      );
    }
    if (externallyRunning) {
      return (
        <StreamingStatusPill
          label={label}
          title="Advanced by the CLI, TUI, or another tab"
          elapsed={formatRunElapsed(startedAt, nowMs)}
          typingKey={turnKey}
        />
      );
    }
    return null;
  }

  if (runState === "streaming" || runState === "starting") {
    return (
      <StreamingStatusPill
        label={label}
        elapsed={formatRunElapsed(startedAt, nowMs)}
        typingKey={turnKey}
      />
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <AlertCircle size={13} strokeWidth={1.75} className="text-warn" />
      <span className="label-status text-fg-dim">
        {runState === "cancelling" ? "stopping" : runState}
      </span>
    </span>
  );
}

function StreamingStatusPill({
  label,
  elapsed,
  title,
  typingKey,
}: {
  label: string;
  elapsed: string | null;
  title?: string;
  typingKey: string;
}): React.ReactElement {
  return (
    <span className="inline-flex items-center gap-2 px-1 py-0.5" title={title}>
      <span aria-hidden="true" className="streaming-status-dot" />
      <ShimmeringTypingText
        className="label-status text-selection"
        text={label}
        typingKey={typingKey}
      />
      {elapsed === null ? null : (
        <span className="inline-flex items-center gap-2 font-mono text-xs leading-4 text-fg-mute">
          {elapsed}
        </span>
      )}
    </span>
  );
}

function ShimmeringTypingText({
  text,
  className,
  shimmerWidth = 140,
  typingKey,
}: {
  text: string;
  className?: string;
  shimmerWidth?: number;
  typingKey: string;
}): React.ReactElement {
  const displayedText = useTypingText(`${text}...`, typingKey);

  return (
    <span
      aria-label={displayedText}
      className={cn("streaming-text-shimmer relative inline-block", className)}
      style={{ "--shiny-width": `${shimmerWidth}px` } as React.CSSProperties}
    >
      <span className="streaming-text-shimmer-base" aria-hidden="true">
        {displayedText}
      </span>
      <span className="streaming-text-shimmer-glare absolute inset-0" aria-hidden="true">
        {displayedText}
      </span>
    </span>
  );
}

type TypingPhase = "idle" | "deleting" | "typing";

interface TypingTextSnapshot {
  displayedText: string;
  phase: TypingPhase;
  targetText: string;
  updatedAt: number;
}

const typingTextSnapshots = new Map<string, TypingTextSnapshot>();

function useTypingText(
  text: string,
  persistenceKey: string,
  typeSpeed = 35,
  deleteSpeed = 18,
): string {
  const initialSnapshotRef = useRef(typingTextSnapshots.get(persistenceKey));
  const [displayedText, setDisplayedText] = useState(
    () => initialSnapshotRef.current?.displayedText ?? "",
  );
  const [phase, setPhase] = useState<TypingPhase>(() => {
    const snapshot = initialSnapshotRef.current;
    if (snapshot === undefined) {
      return "typing";
    }
    return snapshot.targetText === text ? snapshot.phase : "deleting";
  });
  const previousTextRef = useRef(initialSnapshotRef.current?.targetText ?? text);
  const persistenceKeyRef = useRef(persistenceKey);

  useEffect(() => {
    if (persistenceKey === persistenceKeyRef.current) {
      return;
    }
    persistenceKeyRef.current = persistenceKey;
    const snapshot = typingTextSnapshots.get(persistenceKey);
    setDisplayedText(snapshot?.displayedText ?? "");
    setPhase(
      snapshot === undefined
        ? "typing"
        : snapshot.targetText === text
          ? snapshot.phase
          : "deleting",
    );
    previousTextRef.current = snapshot?.targetText ?? text;
  }, [persistenceKey, text]);

  useEffect(() => {
    if (text === previousTextRef.current) {
      return;
    }
    previousTextRef.current = text;
    setPhase("deleting");
  }, [text]);

  useEffect(() => {
    typingTextSnapshots.set(persistenceKey, {
      displayedText,
      phase,
      targetText: text,
      updatedAt: Date.now(),
    });
    pruneTypingTextSnapshots();
  }, [displayedText, persistenceKey, phase, text]);

  useEffect(() => {
    if (phase === "idle") {
      return;
    }

    const timeout = window.setTimeout(
      () => {
        const currentGraphemes = Array.from(displayedText);

        if (phase === "deleting") {
          if (currentGraphemes.length === 0) {
            setPhase("typing");
            return;
          }
          setDisplayedText(currentGraphemes.slice(0, -1).join(""));
          return;
        }

        const targetGraphemes = Array.from(text);
        if (currentGraphemes.length >= targetGraphemes.length) {
          setDisplayedText(text);
          setPhase("idle");
          return;
        }
        setDisplayedText(targetGraphemes.slice(0, currentGraphemes.length + 1).join(""));
      },
      phase === "deleting" ? deleteSpeed : typeSpeed,
    );

    return () => window.clearTimeout(timeout);
  }, [deleteSpeed, displayedText, phase, text, typeSpeed]);

  return displayedText;
}

function pruneTypingTextSnapshots(): void {
  if (typingTextSnapshots.size <= 20) {
    return;
  }
  const snapshots = [...typingTextSnapshots.entries()].sort(
    ([, left], [, right]) => right.updatedAt - left.updatedAt,
  );
  typingTextSnapshots.clear();
  for (const [key, snapshot] of snapshots.slice(0, 20)) {
    typingTextSnapshots.set(key, snapshot);
  }
}

function timestampMs(value: string | null): number | null {
  if (value === null) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function InlineError({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss?: () => void;
}): React.ReactElement {
  const friendly = friendlyChatError(message);
  return (
    <div className="border-b border-bad/35 bg-bad/[0.08] py-3 text-xs text-fg-dim">
      <div className="mx-auto flex w-full max-w-3xl items-start gap-2 px-4 md:px-6">
        <AlertCircle size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-bad" />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="font-medium text-fg">{friendly.title}</div>
          <p className="max-w-5xl whitespace-pre-wrap break-words leading-5">{friendly.message}</p>
          <div className="flex flex-wrap items-center gap-2 text-2xs text-fg-mute">
            {friendly.retryable ? (
              <span>
                Strata automatically retries transient provider failures before surfacing this
                error.
              </span>
            ) : null}
            {friendly.requestId === null ? null : <span>Request {friendly.requestId}</span>}
          </div>
        </div>
        {onDismiss ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Dismiss error"
            title="Dismiss"
            className="-mr-1 h-7 w-7 shrink-0 [&>svg]:!size-[13px]"
            onClick={onDismiss}
          >
            <X size={13} strokeWidth={1.75} />
          </Button>
        ) : null}
      </div>
    </div>
  );
}

function CommandHelp({ onClose }: { onClose(): void }): React.ReactElement {
  return (
    <div className="border-b border-hairline bg-surface px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <TerminalIcon size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-xs font-medium text-fg">Chat commands</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {slashCommandDefinitions().map((command) => (
              <div
                key={command.name}
                className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-2 text-xs"
              >
                <span className="font-mono text-fg">/{command.name}</span>
                <span className="min-w-0 text-fg-mute">{command.description}</span>
              </div>
            ))}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close command help"
          title="Close"
          className="h-7 w-7 shrink-0 [&>svg]:!size-[13px]"
          onClick={onClose}
        >
          <X size={13} strokeWidth={1.75} />
        </Button>
      </div>
    </div>
  );
}

type JsonRecord = Record<string, unknown>;

type ToolExecutionView =
  | { ok: true; toolName: string; result: unknown; truncated: boolean }
  | { ok: false; toolName: string; error: { code: string; message: string }; truncated: false };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordValue(value: unknown): JsonRecord | null {
  return isRecord(value) ? value : null;
}

function parseToolArguments(value: string): JsonRecord | null {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
}

function normalizeToolExecution(tool: ChatToolCallView): ToolExecutionView | null {
  if (!isRecord(tool.result)) {
    return null;
  }
  const ok = tool.result.ok;
  const toolName = stringValue(tool.result.toolName) ?? tool.name;
  if (ok === true) {
    return {
      ok: true,
      toolName,
      result: tool.result.result,
      truncated: booleanValue(tool.result.truncated),
    };
  }
  if (ok === false && isRecord(tool.result.error)) {
    return {
      ok: false,
      toolName,
      error: {
        code: stringValue(tool.result.error.code) ?? "tool_error",
        message: stringValue(tool.result.error.message) ?? "Tool failed.",
      },
      truncated: false,
    };
  }
  return null;
}

function toolSummary(
  tool: ChatToolCallView,
  args: JsonRecord | null,
  execution: ToolExecutionView | null,
): string | null {
  if (execution?.ok === false) {
    return execution.error.message;
  }
  const result = execution?.ok === true && isRecord(execution.result) ? execution.result : null;
  if (tool.name === "wiki.search") {
    const query = stringValue(result?.query) ?? stringValue(args?.query);
    const count = numberValue(result?.count);
    return query === null ? null : count === null ? query : `${query} · ${count} match(es)`;
  }
  if (tool.name === "fs.grep") {
    const pattern =
      stringValue(result?.pattern) ?? stringValue(args?.pattern) ?? stringValue(args?.query);
    const count = numberValue(result?.count);
    return pattern === null ? null : count === null ? pattern : `${pattern} · ${count} match(es)`;
  }
  if (tool.name === "wiki.readPage" || tool.name === "fs.read") {
    return stringValue(result?.path) ?? stringValue(args?.path);
  }
  if (tool.name === "fs.edit" || tool.name === "wiki.patchPage") {
    const path = stringValue(result?.path) ?? stringValue(args?.path);
    const replacements = numberValue(result?.replacements);
    if (path === null) {
      return null;
    }
    return replacements === null ? path : `${path} · ${replacements} replacement(s)`;
  }
  if (tool.name === "shell.run") {
    const exitCode = numberValue(result?.exitCode);
    const command = stringValue(result?.command) ?? stringValue(args?.command);
    if (command === null) {
      return exitCode === null ? null : `exit ${exitCode}`;
    }
    return exitCode === null ? command : `exit ${exitCode} · ${command}`;
  }
  if (tool.name === "memory.write" || tool.name === "memory.append") {
    const document = recordValue(result?.document);
    return stringValue(document?.path) ?? stringValue(args?.target);
  }
  if (tool.name === "todo.add" || tool.name === "todo.update" || tool.name === "todo.remove") {
    const item = recordValue(result?.item) ?? recordValue(result?.removed);
    const title = stringValue(item?.title) ?? stringValue(args?.title);
    const status = stringValue(item?.status);
    if (title === null) {
      return status;
    }
    return status === null ? title : `${status} · ${title}`;
  }
  if (tool.name === "skills.list") {
    const count = numberValue(result?.count);
    return count === null ? null : `${count} skill(s)`;
  }
  if (tool.name === "skills.read") {
    const skill = recordValue(result?.skill);
    const metadata = recordValue(skill?.metadata);
    return stringValue(metadata?.name) ?? stringValue(args?.name);
  }
  return null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanValue(value: unknown): boolean {
  return value === true;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayStrings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

interface OutputPreviewView {
  text: string;
  truncated: boolean;
}

function outputText(value: unknown): OutputPreviewView {
  if (!isRecord(value)) {
    return { text: "", truncated: false };
  }
  return {
    text: stringValue(value.text) ?? "",
    truncated: booleanValue(value.truncated),
  };
}

function searchMatchKey(entry: unknown, index: number): string {
  if (!isRecord(entry)) {
    return `match-${index}`;
  }
  const path = stringValue(entry.path) ?? "unknown";
  const line = numberValue(entry.line)?.toString() ?? index.toString();
  return `${path}:${line}:${index}`;
}

function skillRowKey(entry: unknown, index: number): string {
  if (!isRecord(entry)) {
    return `skill-${index}`;
  }
  return `${stringValue(entry.name) ?? "unknown"}:${stringValue(entry.path) ?? index.toString()}`;
}

function clipPreview(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars)}\n... truncated` : value;
}

function formatDuration(value: number | null): string {
  if (value === null) {
    return "n/a";
  }
  return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(2)}s`;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function formatArguments(value: string): string {
  if (value.trim() === "") {
    return "{}";
  }
  return formatValue(parseJsonValue(value));
}

function formatValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text === undefined) {
    return "undefined";
  }
  return text.length > 2400 ? `${text.slice(0, 2400)}\n... truncated` : text;
}
