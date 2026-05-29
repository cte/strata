import { useLocation, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import type { LanguageModelUsage } from "ai";
import {
  AlertCircle,
  BookOpen,
  Brain,
  Check,
  Copy,
  FileText,
  History,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  PencilLine,
  Search,
  Terminal as TerminalIcon,
  Wrench,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
import { ChatSessionListBody, useDeleteChatSession } from "@/components/chat-session-list";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandList } from "@/components/ui/command";
import {
  addChatQueuedMessage,
  type ChatQueueTarget,
  clearChatQueuedMessages,
  invokeChatSkill,
  listChatQueuedMessages,
  removeChatQueuedMessage,
} from "@/lib/api";
import { chatComposerSubmitState } from "@/lib/chatComposer";
import {
  type QueuedChatMessage,
  queuedChatMessageDescription,
  queuedChatMessageFromSummary,
  queuedChatMessageLabel,
} from "@/lib/chatMessageQueue";
import {
  type ChatMessageView,
  type ChatRunState,
  type ChatToolCallView,
  clientId,
  MAX_ATTACHMENT_BYTES,
} from "@/lib/chatRunModel";
import { chatRunsStore } from "@/lib/chatRunsStore";
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
import type { AutocompleteItem } from "@/lib/useAutocomplete";
import { useAutocomplete } from "@/lib/useAutocomplete";
import { useChatModelChoice } from "@/lib/useChatModelChoice";
import { useChatPromptHistory } from "@/lib/useChatPromptHistory";

import { useChatRun } from "@/lib/useChatRun";
import { useChatSessions } from "@/lib/useChatSessions";
import { cn } from "@/lib/utils";

export function ChatPage(): React.ReactElement {
  const navigate = useNavigate();
  const pathname = useLocation({ select: (location) => location.pathname });
  const params = useParams({ strict: false }) as { sessionId?: string } | undefined;
  const search = useSearch({ strict: false }) as { session?: string } | undefined;
  const routeSessionId = params?.sessionId ?? null;
  const legacySessionId =
    typeof search?.session === "string" && search.session.length > 0 ? search.session : null;
  const urlSessionId = routeSessionId ?? legacySessionId;
  const [prompt, setPrompt] = useState("");
  const [queuedMessages, setQueuedMessages] = useState<QueuedChatMessage[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showCommandHelp, setShowCommandHelp] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
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
      void navigate({
        to: "/chat/$sessionId",
        params: { sessionId: newSessionId },
        replace: options?.replace ?? false,
      });
    },
    [navigate],
  );

  const chatRun = useChatRun({
    urlSessionId,
    selectedModelChoice,
    onSessionChange: handleSessionChange,
  });
  const {
    sessionId,
    transcript,
    runState,
    externallyRunning,
    activeRunId,
    error,
    setError,
    usageTotals,
    submit,
    cancel,
    clearSession,
    forkSession,
  } = chatRun;

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
  const composerDisabled = runState === "cancelling" || externallyRunning;
  const selectedProvider = selectedModelChoice?.provider ?? null;
  const selectedModel = selectedModelChoice?.model ?? null;
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
          }).then(setQueuedMessages, (error: unknown) => setError(errorMessage(error)));
          return;
        }
        submit({ message: invocation.prompt, attachments: [] });
      } catch (error: unknown) {
        setError(error instanceof Error ? error.message : String(error));
      }
    },
    [isRunning, queueTarget, setError, submit],
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
    [clearSession, forkSession, isRunning, queueTarget, setError, submitSkillCommand],
  );

  const handleAutocompleteCommit = useCallback(
    (item: AutocompleteItem, value: string) => {
      if (item.kind !== "command") {
        return;
      }
      recordPromptHistory(value);
      setPrompt("");
      handleSlashCommand(value);
    },
    [handleSlashCommand, recordPromptHistory],
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
        setPrompt("");
        handleSlashCommand(message);
        return;
      }
      if (externallyRunning) {
        return;
      }
      recordPromptHistory(message);
      setPrompt("");
      setShowCommandHelp(false);
      setModelPickerOpen(false);
      if (isRunning) {
        void enqueueChatMessage(queueTarget, {
          id: clientId("queued"),
          message,
          attachments,
        }).then(setQueuedMessages, (error: unknown) => setError(errorMessage(error)));
        return;
      }
      submit({ message, attachments });
    },
    [
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

  const handleCancel = useCallback(() => {
    void clearChatQueuedMessages(queueTarget).then(() => setQueuedMessages([]));
    cancel();
  }, [cancel, queueTarget]);

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

  // Below this point: the original return JSX is preserved verbatim.
  return (
    <div className="chat-surface -mx-6 -my-8 flex h-[calc(100dvh-2.75rem)] flex-col overflow-hidden bg-[var(--bg)] md:-mx-10 md:-my-10">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {error === null ? null : <InlineError message={error} />}
        {showCommandHelp ? <CommandHelp onClose={() => setShowCommandHelp(false)} /> : null}

        <Conversation className="min-h-0 flex-1">
          <ConversationContent
            className={cn(transcript.length === 0 ? "min-h-full pb-32" : "pb-56 md:pb-52")}
          >
            {transcript.length === 0 ? (
              urlSessionId === null ? (
                <InlineChatHistory />
              ) : (
                <ConversationEmptyState
                  title="Ready."
                  description={modelLine}
                  icon={<MessageSquare size={14} strokeWidth={1.75} />}
                />
              )
            ) : (
              transcript.map((message) => <TranscriptMessage key={message.id} message={message} />)
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 px-3 pb-3 md:px-6 md:pb-4">
          <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-col gap-2">
            <div className="flex justify-end px-1">
              <RunStatusBadge
                runState={runState}
                runId={activeRunId}
                externallyRunning={externallyRunning}
              />
            </div>
            <PromptInput
              accept="image/*"
              globalDrop
              maxFileSize={MAX_ATTACHMENT_BYTES}
              multiple
              onError={handlePromptInputError}
              onSubmit={handleSubmit}
              className="rounded-md bg-[var(--bg-elev)] [&_[data-slot=input-group]]:rounded-md [&_[data-slot=input-group]]:border-[var(--hairline)] [&_[data-slot=input-group]]:bg-[var(--bg-elev)] [&_[data-slot=input-group]]:shadow-none"
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
                queuedMessages={queuedMessages}
                onRemoveQueuedMessage={handleRemoveQueuedMessage}
              />
              <PromptInputBody>
                <PromptInputTextarea
                  inputRef={promptInputRef}
                  value={prompt}
                  onChange={(event) => setPrompt(event.currentTarget.value)}
                  onFocus={autocomplete.refresh}
                  onKeyDown={handlePromptUnhandledKeyDown}
                  disabled={composerDisabled}
                  className="min-h-12 text-[13px] leading-5 md:text-[13px]"
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
                    choice={selectedModelChoice}
                    providerStates={modelProviderStates}
                    open={modelPickerOpen}
                    onOpenChange={setModelPickerOpen}
                    onSelect={setModelChoice}
                    onReasoningEffortChange={setModelReasoningEffort}
                    disabled={composerDisabled}
                  />
                </PromptInputTools>
                <PromptInputTools className="shrink-0 justify-end gap-2">
                  <ContextUsageIndicator usage={usageTotals} contextWindow={contextWindow} />
                  <ChatPromptSubmit
                    prompt={prompt}
                    runState={runState}
                    externallyRunning={externallyRunning}
                    onStop={handleCancel}
                  />
                </PromptInputTools>
              </PromptInputFooter>
            </PromptInput>
          </div>
        </div>
      </section>
    </div>
  );
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
  });
  return refreshQueuedMessages(target);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recent-chats list shown on a fresh chat surface in place of "Ready.". Reuses
 * the same session rows as the ⌘K palette and disappears once a transcript
 * starts. Brand-new users (no sessions yet) get a simple ready affordance.
 */
function InlineChatHistory(): React.ReactElement {
  const navigate = useNavigate();
  const { sessions, isLoaded, error } = useChatSessions();
  const handleDelete = useDeleteChatSession();
  const handleSelect = useCallback(
    (sessionId: string) => {
      void navigate({ to: "/chat/$sessionId", params: { sessionId } });
    },
    [navigate],
  );

  if (isLoaded && !error && sessions.length === 0) {
    return (
      <ConversationEmptyState
        title="Ready."
        description="Start a new chat below."
        icon={<MessageSquare size={14} strokeWidth={1.75} />}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-1 py-8">
      <p className="mb-2 flex items-center gap-1.5 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--fg-mute)]">
        <History size={12} strokeWidth={1.75} />
        Recent Sessions
      </p>
      <Command
        shouldFilter={false}
        className="rounded-lg border border-[var(--hairline)] bg-[var(--bg-elev)]"
      >
        <CommandList className="max-h-[min(60dvh,32rem)]">
          <ChatSessionListBody
            sessions={sessions}
            isLoaded={isLoaded}
            error={Boolean(error)}
            onSelect={handleSelect}
            onDelete={handleDelete}
          />
        </CommandList>
      </Command>
    </div>
  );
}

function ChatPromptHeader({
  queuedMessages,
  onRemoveQueuedMessage,
}: {
  queuedMessages: QueuedChatMessage[];
  onRemoveQueuedMessage(id: string): void;
}): React.ReactElement | null {
  const attachments = usePromptInputAttachments();
  if (queuedMessages.length === 0 && attachments.files.length === 0) {
    return null;
  }
  return (
    <PromptInputHeader className="flex-col items-stretch gap-2">
      {queuedMessages.length === 0 ? null : (
        <QueuedPromptMessages messages={queuedMessages} onRemoveMessage={onRemoveQueuedMessage} />
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
}: {
  messages: QueuedChatMessage[];
  onRemoveMessage(id: string): void;
}): React.ReactElement {
  return (
    <Queue className="w-full rounded-md border-[var(--hairline)] bg-transparent px-2 py-1.5 shadow-none">
      <QueueSection defaultOpen>
        <QueueSectionTrigger className="bg-transparent px-1.5 py-1 text-[12px] font-medium text-[var(--fg-mute)] hover:bg-[var(--surface-2)]">
          <QueueSectionLabel count={messages.length} label="Queued" />
        </QueueSectionTrigger>
        <QueueSectionContent>
          <QueueList className="mt-1 -mb-0">
            {messages.map((message) => (
              <QueuedPromptMessage
                key={message.id}
                message={message}
                onRemove={() => onRemoveMessage(message.id)}
              />
            ))}
          </QueueList>
        </QueueSectionContent>
      </QueueSection>
    </Queue>
  );
}

function QueuedPromptMessage({
  message,
  onRemove,
}: {
  message: QueuedChatMessage;
  onRemove(): void;
}): React.ReactElement {
  const description = queuedChatMessageDescription(message);
  return (
    <QueueItem className="px-1.5 py-1.5 text-[12px] hover:bg-[var(--surface-2)]">
      <div className="flex min-w-0 items-start gap-2">
        <QueueItemIndicator className="mt-[0.45rem] size-2 shrink-0 border-[var(--fg-mute)]/60" />
        <QueueItemContent className="min-w-0 text-[12px] leading-5 text-[var(--fg)]">
          {queuedChatMessageLabel(message)}
        </QueueItemContent>
        <QueueItemActions className="ml-auto shrink-0">
          <QueueItemAction
            aria-label="Remove queued message"
            className="opacity-100 [&>svg]:!size-3"
            onClick={onRemove}
          >
            <X size={12} strokeWidth={1.75} />
          </QueueItemAction>
        </QueueItemActions>
      </div>
      {description === null ? null : (
        <QueueItemDescription className="ml-4 text-[11.5px] leading-4 text-[var(--fg-mute)]">
          {description}
        </QueueItemDescription>
      )}
      {message.attachments.length === 0 ? null : (
        <QueueItemAttachment className="ml-4 mt-1 gap-1.5">
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
        className="size-7 rounded-sm border-[var(--hairline)]"
        src={attachment.url}
      />
    );
  }

  return (
    <QueueItemFile className="border-[var(--hairline)] bg-[var(--surface)] text-[11.5px]">
      {label}
    </QueueItemFile>
  );
}

function ChatPromptSubmit({
  prompt,
  runState,
  externallyRunning,
  onStop,
}: {
  prompt: string;
  runState: ChatRunState;
  externallyRunning: boolean;
  onStop(): void;
}): React.ReactElement {
  const attachments = usePromptInputAttachments();
  const submitState = chatComposerSubmitState({
    prompt,
    attachmentCount: attachments.files.length,
    runState,
    externallyRunning,
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

function TranscriptMessage({ message }: { message: ChatMessageView }): React.ReactElement {
  const showActions =
    (message.role === "assistant" || message.role === "user") &&
    message.status === "complete" &&
    message.content !== "";
  const showUsage =
    message.role === "assistant" && message.status === "complete" && message.usage !== undefined;
  return (
    <Message from={message.role} status={message.status}>
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
        {message.content === "" ? null : (
          <MessageContent>
            {message.role === "assistant" ? (
              <MessageResponse>{message.content}</MessageResponse>
            ) : (
              message.content
            )}
          </MessageContent>
        )}
        {message.toolCalls.length === 0 ? null : (
          <div className="mt-2 flex w-full flex-col gap-2">
            {message.toolCalls.map((tool) => (
              <ToolPanel key={tool.id} tool={tool} />
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
}

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
      className="ml-1 inline-flex items-center gap-1 font-mono text-[10.5px] leading-4 text-[var(--fg-mute)]"
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
        <Check size={13} strokeWidth={1.75} className="text-[var(--good)]" />
      ) : (
        <Copy size={13} strokeWidth={1.75} />
      )}
    </MessageAction>
  );
}

function ToolPanel({ tool }: { tool: ChatToolCallView }): React.ReactElement {
  const args = parseToolArguments(tool.argumentsText);
  const execution = normalizeToolExecution(tool);
  const summary = toolSummary(tool, args, execution);

  return (
    <Tool status={tool.status} open={tool.status !== "complete"}>
      <ToolHeader>
        <span className="flex min-w-0 items-center gap-2">
          <ToolIcon name={tool.name} />
          <span className="truncate font-mono text-[11.5px] text-[var(--fg)]">{tool.name}</span>
          {summary === null ? null : (
            <span className="hidden truncate text-[11.5px] text-[var(--fg-mute)] sm:inline">
              {summary}
            </span>
          )}
        </span>
        <span
          className={cn(
            "label-eyebrow ml-auto",
            tool.status === "running" && "!text-[var(--warn)]",
            tool.status === "complete" && "!text-[var(--good)]",
            tool.status === "error" && "!text-[var(--bad)]",
          )}
        >
          {tool.status}
        </span>
      </ToolHeader>
      <ToolContent>
        <SpecializedToolContent tool={tool} args={args} execution={execution} />
      </ToolContent>
    </Tool>
  );
}

function ToolIcon({ name }: { name: string }): React.ReactElement {
  const className = "shrink-0 text-[var(--accent)]";
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
        <p className="text-[12px] text-[var(--fg-mute)]">No matches returned.</p>
      ) : (
        <div className="overflow-hidden border border-[var(--hairline)]">
          {matches.slice(0, 8).map((entry, index) => (
            <SearchMatchRow key={searchMatchKey(entry, index)} entry={entry} />
          ))}
          {matches.length > 8 ? (
            <div className="border-t border-[var(--hairline)] px-2 py-1.5 text-[11.5px] text-[var(--fg-mute)]">
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
    <div className="border-t border-[var(--hairline)] px-2 py-2 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-[11.5px] text-[var(--fg)]">{path}</span>
        {line === null ? null : (
          <span className="shrink-0 font-mono text-[11.5px] text-[var(--fg-mute)]">:{line}</span>
        )}
      </div>
      <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--fg-dim)]">{preview}</p>
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
        <p className="text-[12px] text-[var(--fg-mute)]">No stdout or stderr output.</p>
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
      className="rounded-md border-[var(--hairline)] bg-zinc-950 text-zinc-100"
    >
      <TerminalHeader className="border-zinc-800 px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <TerminalTitle>{label}</TerminalTitle>
          {truncated ? (
            <span className="font-mono text-[10.5px] leading-4 text-[var(--bad)]">truncated</span>
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
      {stdout === "" && stderr === "" ? (
        <p className="text-[12px] text-[var(--fg-mute)]">Running…</p>
      ) : null}
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
        <p className="text-[12px] text-[var(--fg-mute)]">No skills returned.</p>
      ) : (
        <div className="overflow-hidden border border-[var(--hairline)]">
          {skills.slice(0, 10).map((entry, index) => (
            <SkillRow key={skillRowKey(entry, index)} entry={entry} />
          ))}
          {skills.length > 10 ? (
            <div className="border-t border-[var(--hairline)] px-2 py-1.5 text-[11.5px] text-[var(--fg-mute)]">
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
    <div className="border-t border-[var(--hairline)] px-2 py-2 first:border-t-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-mono text-[11.5px] text-[var(--fg)]">{name}</span>
        <span className="shrink-0 font-mono text-[11.5px] text-[var(--fg-mute)]">
          {source}
          {status === "" ? "" : `/${status}`}
        </span>
      </div>
      {description === "" ? null : (
        <p className="mt-1 line-clamp-2 text-[11.5px] leading-5 text-[var(--fg-dim)]">
          {description}
        </p>
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
    <div className="min-w-0 border border-[var(--hairline)] bg-[var(--surface)] px-2 py-1.5">
      <div className="label-eyebrow text-[var(--fg-mute)]">{label}</div>
      <div
        className={cn(
          "mt-0.5 truncate font-mono text-[11.5px]",
          tone === "good" && "text-[var(--good)]",
          tone === "bad" && "text-[var(--bad)]",
          tone === "default" && "text-[var(--fg)]",
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
      <div className="label-eyebrow mb-1 text-[var(--fg-mute)]">{label}</div>
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[var(--surface)] p-2 text-[11.5px] leading-5 text-[var(--fg-dim)]">
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
          "h-7 gap-1.5 rounded-md border border-[var(--hairline)] bg-[var(--surface)] px-2 py-0 font-mono text-[11.5px]",
          contextPercent !== undefined &&
            contextPercent > 70 &&
            "border-[var(--warn)]/45 text-[var(--warn)] hover:text-[var(--warn)]",
          contextPercent !== undefined &&
            contextPercent > 90 &&
            "border-[var(--bad)]/45 text-[var(--bad)] hover:text-[var(--bad)]",
        )}
      />
      <ContextContent
        align="end"
        className="w-72 border-[var(--hairline-strong)] bg-[var(--surface)] text-[var(--fg)]"
      >
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
          <ContextContentFooter className="bg-[var(--surface-2)]">
            <span className="text-[var(--fg-mute)]">Total cost</span>
            <span>${usage.cost.toFixed(3)}</span>
          </ContextContentFooter>
        ) : null}
      </ContextContent>
    </Context>
  );
}

function ContextUsageRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 text-[12px]">
      <span className="text-[var(--fg-mute)]">{label}</span>
      <span className="font-mono text-[var(--fg)]">{value}</span>
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
  runId,
  externallyRunning,
}: {
  runState: ChatRunState;
  runId: string | null;
  externallyRunning: boolean;
}): React.ReactElement {
  if (runState === "idle") {
    if (externallyRunning) {
      return (
        <span
          className="inline-flex items-center gap-2"
          title="Advanced by the CLI, TUI, or another tab"
        >
          <LoaderCircle
            size={13}
            strokeWidth={1.75}
            className="animate-spin text-[var(--accent)]"
          />
          <span className="label-eyebrow text-[var(--fg-dim)]">running elsewhere</span>
        </span>
      );
    }
    return <Badge tone="muted">idle</Badge>;
  }
  return (
    <span className="inline-flex items-center gap-2">
      {runState === "cancelling" ? (
        <AlertCircle size={13} strokeWidth={1.75} className="text-[var(--warn)]" />
      ) : runState === "disconnected" ? (
        <AlertCircle size={13} strokeWidth={1.75} className="text-[var(--warn)]" />
      ) : (
        <LoaderCircle size={13} strokeWidth={1.75} className="animate-spin text-[var(--accent)]" />
      )}
      <span className="label-eyebrow text-[var(--fg-dim)]">
        {runState === "starting" ? "starting" : runState}
        {runId === null ? "" : ` ${runId.slice(0, 8)}`}
      </span>
    </span>
  );
}

function InlineError({ message }: { message: string }): React.ReactElement {
  return (
    <div className="flex items-start gap-2 border-b border-[var(--bad)]/35 bg-[var(--bad)]/[0.06] px-4 py-2 text-[12px] text-[var(--fg-dim)]">
      <AlertCircle size={13} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--bad)]" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

function CommandHelp({ onClose }: { onClose(): void }): React.ReactElement {
  return (
    <div className="border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <TerminalIcon
          size={13}
          strokeWidth={1.75}
          className="mt-0.5 shrink-0 text-[var(--accent)]"
        />
        <div className="min-w-0 flex-1">
          <div className="mb-2 text-[12px] font-medium text-[var(--fg)]">Chat commands</div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {slashCommandDefinitions().map((command) => (
              <div
                key={command.name}
                className="grid min-w-0 grid-cols-[4.75rem_minmax(0,1fr)] gap-2 text-[11.5px]"
              >
                <span className="font-mono text-[var(--fg)]">/{command.name}</span>
                <span className="min-w-0 text-[var(--fg-mute)]">{command.description}</span>
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
