import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  AlertCircle,
  BookOpen,
  Brain,
  Check,
  Copy,
  FileText,
  ListTodo,
  LoaderCircle,
  MessageSquare,
  PencilLine,
  Search,
  Terminal,
  Wrench,
  X,
} from "lucide-react";
import type * as React from "react";
import { useCallback, useMemo, useState } from "react";
import type { AttachmentData } from "@/components/ai-elements/attachments";
import { Attachment, AttachmentPreview, Attachments } from "@/components/ai-elements/attachments";
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
import { PromptInput } from "@/components/ai-elements/prompt-input";
import { Tool, ToolContent, ToolHeader } from "@/components/ai-elements/tool";
import { ChatModelPicker } from "@/components/chat-model-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChatMessageView,
  type ChatRunState,
  type ChatToolCallView,
  errorMessage,
  MAX_ATTACHMENT_BYTES,
  readFileAsAttachment,
} from "@/lib/chatRunModel";
import {
  contextUsagePercent,
  contextWindowForModel,
  formatTokens,
  hasTokenUsage,
  type TokenUsage,
  type TokenUsageTotals,
} from "@/lib/chatUsage";
import { createFileMentionProvider } from "@/lib/fileMentionProvider";
import {
  createSlashCommandProvider,
  parseSlashCommand,
  slashCommandDefinitions,
} from "@/lib/slashCommandProvider";
import type { AutocompleteItem } from "@/lib/useAutocomplete";
import { useChatModelChoice } from "@/lib/useChatModelChoice";
import { useChatPromptHistory } from "@/lib/useChatPromptHistory";
import { useChatRun } from "@/lib/useChatRun";
import { cn } from "@/lib/utils";

export function ChatPage(): React.ReactElement {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { session?: string } | undefined;
  const urlSessionId = search?.session ?? null;
  const [prompt, setPrompt] = useState("");
  const [attachments, setAttachments] = useState<AttachmentData[]>([]);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [showCommandHelp, setShowCommandHelp] = useState(false);
  const autocompleteProviders = useMemo(
    () => [createSlashCommandProvider(), createFileMentionProvider()],
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

  const handleSessionChange = useCallback(
    (newSessionId: string | null, options?: { replace?: boolean }) => {
      void navigate({
        to: "/chat",
        search: newSessionId === null ? {} : { session: newSessionId },
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
  } = chatRun;

  const isRunning = runState !== "idle";
  const selectedProvider = selectedModelChoice?.provider ?? null;
  const selectedModel = selectedModelChoice?.model ?? null;
  const contextWindow = useMemo(
    () =>
      selectedProvider === null || selectedModel === null
        ? undefined
        : contextWindowForModel(selectedProvider, selectedModel),
    [selectedProvider, selectedModel],
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
      }
    },
    [clearSession, forkSession, setError],
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

  const handlePromptUnhandledKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => onPromptHistoryKeyDown(event, prompt),
    [onPromptHistoryKeyDown, prompt],
  );

  const handleSubmit = useCallback(() => {
    const message = prompt.trim();
    const hasAttachments = attachments.length > 0;
    if ((message === "" && !hasAttachments) || isRunning) {
      return;
    }
    if (!hasAttachments && message.startsWith("/")) {
      recordPromptHistory(message);
      setPrompt("");
      handleSlashCommand(message);
      return;
    }
    recordPromptHistory(message);
    setPrompt("");
    setAttachments([]);
    setShowCommandHelp(false);
    setModelPickerOpen(false);
    submit({ message, attachments });
  }, [attachments, handleSlashCommand, isRunning, prompt, recordPromptHistory, submit]);

  const handleAddFiles = useCallback(
    (files: FileList) => {
      const incoming = Array.from(files);
      void Promise.all(incoming.map(readFileAsAttachment))
        .then((results) => {
          const successes = results.filter((value): value is AttachmentData => value !== null);
          const oversized = incoming.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
          if (oversized.length > 0) {
            setError(
              `Skipped ${oversized.length} file(s) larger than ${(MAX_ATTACHMENT_BYTES / (1024 * 1024)).toFixed(0)}MB.`,
            );
          }
          if (successes.length > 0) {
            setAttachments((current) => [...current, ...successes]);
          }
        })
        .catch((cause: unknown) => {
          setError(errorMessage(cause));
        });
    },
    [setError],
  );

  const handleRemoveAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }, []);

  const handleCancel = useCallback(() => cancel(), [cancel]);

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
    <div className="-mx-6 -my-8 flex h-[calc(100dvh-2.75rem)] flex-col overflow-hidden bg-[var(--bg)] md:-mx-10 md:-my-10">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-[var(--hairline)] bg-[var(--bg-elev)] px-4 py-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <MessageSquare size={15} strokeWidth={1.75} className="text-[var(--accent)]" />
              <h1 className="text-[14px] font-medium tracking-tight text-[var(--fg)]">
                {sessionTitle ?? "Chat"}
              </h1>
            </div>
            <p className="mt-1 flex min-w-0 items-center font-mono text-[11px] text-[var(--fg-mute)]">
              {sessionId === null ? (
                <span className="truncate">new session</span>
              ) : (
                <SessionIdCopy sessionId={sessionId} />
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <UsageMetrics usage={usageTotals} contextWindow={contextWindow} />
            <RunStatusBadge runState={runState} runId={activeRunId} />
          </div>
        </header>

        {error === null ? null : <InlineError message={error} />}
        {showCommandHelp ? <CommandHelp onClose={() => setShowCommandHelp(false)} /> : null}

        <Conversation className="min-h-0 flex-1">
          <ConversationContent>
            {transcript.length === 0 ? (
              <ConversationEmptyState
                title="Ready."
                description={modelLine}
                icon={<MessageSquare size={16} strokeWidth={1.75} />}
              />
            ) : (
              transcript.map((message) => <TranscriptMessage key={message.id} message={message} />)
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>

        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-[var(--bg)] via-[var(--bg)] to-transparent px-3 pt-10 pb-3 md:px-6 md:pb-4">
          <div className="pointer-events-auto mx-auto w-full max-w-3xl">
            <PromptInput
              value={prompt}
              running={isRunning}
              disabled={runState === "cancelling"}
              attachments={attachments}
              onValueChange={setPrompt}
              onSubmit={handleSubmit}
              onCancel={handleCancel}
              onAddFiles={handleAddFiles}
              onRemoveAttachment={handleRemoveAttachment}
              autocompleteProviders={autocompleteProviders}
              onAutocompleteCommit={handleAutocompleteCommit}
              onUnhandledKeyDown={handlePromptUnhandledKeyDown}
              toolbar={
                <ChatModelPicker
                  choice={selectedModelChoice}
                  providerStates={modelProviderStates}
                  open={modelPickerOpen}
                  onOpenChange={setModelPickerOpen}
                  onSelect={setModelChoice}
                  onReasoningEffortChange={setModelReasoningEffort}
                  disabled={runState === "cancelling"}
                />
              }
              className="rounded-xl border border-[var(--hairline)] bg-[var(--bg-elev)] p-2 shadow-lg shadow-black/30"
            />
          </div>
        </div>
      </section>
    </div>
  );
}

function TranscriptMessage({ message }: { message: ChatMessageView }): React.ReactElement {
  const showActions =
    message.role === "assistant" && message.status === "complete" && message.content !== "";
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
      className="ml-1 inline-flex items-center gap-1 font-mono text-[10px] text-[var(--fg-mute)]"
    >
      {compact}
    </span>
  );
}

function SessionIdCopy({ sessionId }: { sessionId: string }): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(sessionId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  }, [sessionId]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      title={copied ? "Copied" : "Copy session id"}
      className="group inline-flex min-w-0 items-center gap-1.5 truncate text-left text-[var(--fg-mute)] transition-colors duration-150 hover:text-[var(--fg)]"
    >
      <span className="truncate">{sessionId}</span>
      {copied ? (
        <Check size={11} strokeWidth={1.75} className="shrink-0 text-[var(--good)]" />
      ) : (
        <Copy
          size={11}
          strokeWidth={1.75}
          className="shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-visible:opacity-100"
        />
      )}
    </button>
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
    <MessageAction tooltip={copied ? "Copied" : "Copy message"} onClick={handleCopy}>
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
            tool.status === "running" && "text-[var(--warn)]",
            tool.status === "complete" && "text-[var(--good)]",
            tool.status === "error" && "text-[var(--bad)]",
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
    return <Terminal size={13} strokeWidth={1.75} className={className} />;
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
            <div className="border-t border-[var(--hairline)] px-2 py-1.5 text-[11px] text-[var(--fg-mute)]">
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
        <span className="truncate font-mono text-[11px] text-[var(--fg)]">{path}</span>
        {line === null ? null : (
          <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-mute)]">:{line}</span>
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
        <ToolMetric label="truncated" value={truncated ? "yes" : "no"} />
      </ToolMetricGrid>
      <PreviewBlock label="command" value={command} />
      <ToolMetric label="cwd" value={cwd} />
      {stdout === "" ? null : <PreviewBlock label="stdout" value={clipPreview(stdout, 1800)} />}
      {stderr === "" ? null : <PreviewBlock label="stderr" value={clipPreview(stderr, 1800)} />}
      {stdout === "" && stderr === "" ? (
        <p className="text-[12px] text-[var(--fg-mute)]">No stdout or stderr output.</p>
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
            <div className="border-t border-[var(--hairline)] px-2 py-1.5 text-[11px] text-[var(--fg-mute)]">
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
        <span className="truncate font-mono text-[11px] text-[var(--fg)]">{name}</span>
        <span className="shrink-0 font-mono text-[10.5px] text-[var(--fg-mute)]">
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
      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-sm bg-[var(--surface)] p-2 text-[11px] leading-5 text-[var(--fg-dim)]">
        {value}
      </pre>
    </div>
  );
}

function UsageMetrics({
  usage,
  contextWindow,
}: {
  usage: TokenUsageTotals;
  contextWindow: number | undefined;
}): React.ReactElement | null {
  if (!hasTokenUsage(usage) && contextWindow === undefined) {
    return null;
  }
  const contextPercent = contextUsagePercent(usage.latestContextTokens, contextWindow);
  const contextValue =
    contextWindow === undefined
      ? null
      : contextPercent === undefined
        ? `?/${formatTokens(contextWindow)}`
        : `${contextPercent.toFixed(1)}%/${formatTokens(contextWindow)}`;
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-end gap-1">
      {usage.input > 0 ? <MetricPill label="in" value={formatTokens(usage.input)} /> : null}
      {usage.output > 0 ? <MetricPill label="out" value={formatTokens(usage.output)} /> : null}
      {usage.cacheRead > 0 ? (
        <MetricPill label="read" value={formatTokens(usage.cacheRead)} />
      ) : null}
      {usage.cacheWrite > 0 ? (
        <MetricPill label="write" value={formatTokens(usage.cacheWrite)} />
      ) : null}
      {usage.cost > 0 ? <MetricPill label="cost" value={`$${usage.cost.toFixed(3)}`} /> : null}
      {contextValue === null ? null : (
        <MetricPill
          label="ctx"
          value={contextValue}
          tone={
            contextPercent === undefined
              ? "default"
              : contextPercent > 90
                ? "bad"
                : contextPercent > 70
                  ? "warn"
                  : "default"
          }
        />
      )}
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "warn" | "bad";
}): React.ReactElement {
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded border border-[var(--hairline)] bg-[var(--surface)] px-1.5 font-mono text-[10.5px]",
        tone === "default" && "text-[var(--fg-mute)]",
        tone === "warn" && "border-[var(--warn)]/45 text-[var(--warn)]",
        tone === "bad" && "border-[var(--bad)]/45 text-[var(--bad)]",
      )}
      title={`${label}: ${value}`}
    >
      <span className="text-[var(--fg-dim)]">{label}</span>
      <span className={tone === "default" ? "text-[var(--fg)]" : undefined}>{value}</span>
    </span>
  );
}

function RunStatusBadge({
  runState,
  runId,
}: {
  runState: ChatRunState;
  runId: string | null;
}): React.ReactElement {
  if (runState === "idle") {
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
    <div className="flex items-start gap-2 border-b border-[var(--bad)]/35 bg-[var(--bad)]/[0.06] px-4 py-2 text-[12.5px] text-[var(--fg-dim)]">
      <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--bad)]" />
      <span className="min-w-0 break-words">{message}</span>
    </div>
  );
}

function CommandHelp({ onClose }: { onClose(): void }): React.ReactElement {
  return (
    <div className="border-b border-[var(--hairline)] bg-[var(--surface)] px-4 py-3">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <Terminal size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[var(--accent)]" />
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
          className="h-7 w-7 shrink-0"
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

function outputText(value: unknown): string {
  if (!isRecord(value)) {
    return "";
  }
  return stringValue(value.text) ?? "";
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
