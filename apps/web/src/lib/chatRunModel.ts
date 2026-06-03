import type { AttachmentData } from "@/components/ai-elements/attachments";
import type { ChatImageAttachment, ChatMessageSummary, ChatStreamEvent } from "@/lib/api";
import type { TokenUsage } from "@/lib/chatUsage";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export { MAX_ATTACHMENT_BYTES };

export type MessageStatus = "streaming" | "complete" | "error";
export type ToolStatus = "running" | "complete" | "error";
export type ChatRunState = "idle" | "starting" | "streaming" | "cancelling" | "disconnected";

export interface ChatToolCallView {
  id: string;
  name: string;
  argumentsText: string;
  status: ToolStatus;
  summary?: string;
  resultAvailable?: boolean;
  result?: unknown;
  /** Incremental stdout/stderr streamed via `tool.output` while the tool runs. */
  liveOutput?: { stdout: string; stderr: string };
}

export type SystemMessageKind = "status" | "summary";

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Streamed reasoning/thinking summary for this assistant turn, if any. */
  reasoning?: string;
  status: MessageStatus;
  toolCalls: ChatToolCallView[];
  runId?: string;
  iteration?: number;
  clientMessageId?: string;
  pendingKind?: "steering";
  systemKind?: SystemMessageKind;
  attachments?: AttachmentData[];
  usage?: TokenUsage;
}

export interface ChatSubmitInput {
  message: string;
  attachments: AttachmentData[];
}

// ---------------------------------------------------------------------------
// Pure transitions on a transcript. Each takes the prior `ChatMessageView[]`
// and returns the next one with no side effects, so the React reducer can
// stay deterministic.
// ---------------------------------------------------------------------------

export function appendAssistantDelta(
  messages: ChatMessageView[],
  runId: string | null,
  iteration: number,
  delta: string,
): ChatMessageView[] {
  const index = findAssistantByRunIteration(messages, runId, iteration);
  if (index === -1) {
    return [
      ...messages,
      {
        id: clientId("assistant"),
        role: "assistant",
        ...runScope(runId),
        iteration,
        content: delta,
        status: "streaming",
        toolCalls: [],
      },
    ];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? { ...message, content: `${message.content}${delta}`, status: "streaming" }
      : message,
  );
}

export function appendAssistantReasoning(
  messages: ChatMessageView[],
  runId: string | null,
  iteration: number,
  delta: string,
): ChatMessageView[] {
  const index = findAssistantByRunIteration(messages, runId, iteration);
  if (index === -1) {
    return [
      ...messages,
      {
        id: clientId("assistant"),
        role: "assistant",
        ...runScope(runId),
        iteration,
        content: "",
        reasoning: delta,
        status: "streaming",
        toolCalls: [],
      },
    ];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? { ...message, reasoning: `${message.reasoning ?? ""}${delta}`, status: "streaming" }
      : message,
  );
}

export function finalizeAssistantResponse(
  messages: ChatMessageView[],
  runId: string | null,
  iteration: number,
  content: string,
  toolCalls: Array<{ id: string; name: string; argumentsText: string }>,
  usage: TokenUsage | undefined,
  reasoning?: string,
): ChatMessageView[] {
  const nextToolCalls = toolCalls.map((toolCall) => ({
    id: toolCall.id,
    name: toolCall.name,
    argumentsText: toolCall.argumentsText,
    status: "running" as const,
  }));
  const index = findAssistantByRunIteration(messages, runId, iteration);
  if (index === -1) {
    return [
      ...messages,
      {
        id: clientId("assistant"),
        role: "assistant",
        ...runScope(runId),
        iteration,
        content,
        status: "complete",
        toolCalls: nextToolCalls,
        ...(reasoning === undefined || reasoning === "" ? {} : { reasoning }),
        ...(usage === undefined ? {} : { usage }),
      },
    ];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          content,
          status: "complete",
          toolCalls: mergeToolCalls(message.toolCalls, nextToolCalls),
          // Prefer the canonical reasoning from model.response; fall back to the
          // text accumulated from streamed deltas.
          ...(reasoning === undefined || reasoning === "" ? {} : { reasoning }),
          ...(usage === undefined ? {} : { usage }),
        }
      : message,
  );
}

export function startToolCall(
  messages: ChatMessageView[],
  runId: string | null,
  event: Extract<ChatStreamEvent, { type: "tool.call.started" }>,
): ChatMessageView[] {
  const tool: ChatToolCallView = {
    id: event.toolCallId,
    name: event.toolName,
    argumentsText: event.argumentsText,
    status: "running",
  };
  const index = findMessageWithTool(messages, event.toolCallId);
  if (index !== -1) {
    return messages.map((message, messageIndex) =>
      messageIndex === index
        ? { ...message, toolCalls: mergeToolCalls(message.toolCalls, [tool]) }
        : message,
    );
  }

  const assistantIndex = findLastAssistantForRun(messages, runId);
  if (assistantIndex !== -1) {
    return messages.map((message, messageIndex) =>
      messageIndex === assistantIndex
        ? { ...message, toolCalls: mergeToolCalls(message.toolCalls, [tool]) }
        : message,
    );
  }

  return [
    ...messages,
    {
      id: clientId("assistant"),
      role: "assistant",
      ...runScope(runId),
      content: "",
      status: "complete",
      toolCalls: [tool],
    },
  ];
}

export function appendToolOutput(
  messages: ChatMessageView[],
  toolCallId: string,
  stream: "stdout" | "stderr",
  textDelta: string,
): ChatMessageView[] {
  const index = findMessageWithTool(messages, toolCallId);
  if (index === -1) {
    return messages;
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          toolCalls: message.toolCalls.map((toolCall) => {
            if (toolCall.id !== toolCallId) {
              return toolCall;
            }
            const live = toolCall.liveOutput ?? { stdout: "", stderr: "" };
            return {
              ...toolCall,
              liveOutput: { ...live, [stream]: `${live[stream]}${textDelta}` },
            };
          }),
        }
      : message,
  );
}

export function completeToolCall(
  messages: ChatMessageView[],
  toolCallId: string,
  result: unknown,
): ChatMessageView[] {
  const status: ToolStatus = isToolErrorResult(result) ? "error" : "complete";
  const index = findMessageWithTool(messages, toolCallId);
  if (index === -1) {
    return [
      ...messages,
      {
        id: clientId("assistant"),
        role: "assistant",
        content: "",
        status: "complete",
        toolCalls: [{ id: toolCallId, name: "tool", argumentsText: "", status, result }],
      },
    ];
  }
  return messages.map((message, messageIndex) =>
    messageIndex === index
      ? {
          ...message,
          toolCalls: message.toolCalls.map((toolCall) =>
            toolCall.id === toolCallId ? { ...toolCall, status, result } : toolCall,
          ),
        }
      : message,
  );
}

export function appendSystemMessage(
  messages: ChatMessageView[],
  content: string,
  options: { status?: MessageStatus; systemKind?: SystemMessageKind } = {},
): ChatMessageView[] {
  return [
    ...messages,
    {
      id: clientId("system"),
      role: "system",
      content,
      status: options.status ?? "complete",
      toolCalls: [],
      ...(options.systemKind === undefined ? {} : { systemKind: options.systemKind }),
    },
  ];
}

export function appendPendingUserMessageFromEvent(
  messages: ChatMessageView[],
  event: Extract<ChatStreamEvent, { type: "message.user.pending" }>,
): ChatMessageView[] {
  if (messages.some((message) => message.clientMessageId === event.clientMessageId)) {
    return messages;
  }
  const attachments = attachmentsToAttachmentData(event.attachments);
  return [
    ...messages,
    {
      id: `pending-user-${event.clientMessageId}`,
      role: "user",
      content: event.content,
      status: "streaming",
      toolCalls: [],
      clientMessageId: event.clientMessageId,
      pendingKind: "steering",
      ...(attachments.length === 0 ? {} : { attachments }),
    },
  ];
}

export function appendUserMessageFromEvent(
  messages: ChatMessageView[],
  event: Extract<ChatStreamEvent, { type: "message.user" }>,
  options: { dedupeLast?: boolean } = {},
): ChatMessageView[] {
  const attachments = attachmentsToAttachmentData(event.attachments);
  const content = event.content;
  if (event.clientMessageId !== undefined) {
    const index = messages.findIndex(
      (message) => message.clientMessageId === event.clientMessageId,
    );
    if (index !== -1) {
      return confirmUserMessageAt(messages, index, event.clientMessageId, content, attachments);
    }
  }
  const last = messages.at(-1);
  if (options.dedupeLast === true && last?.role === "user") {
    const lastAttachmentCount = last.attachments?.length ?? 0;
    const sameContent =
      last.content === content ||
      (last.content.trim() === "" && content === "(image attached)" && attachments.length > 0);
    if (sameContent && lastAttachmentCount === attachments.length) {
      return confirmUserMessageAt(
        messages,
        messages.length - 1,
        event.clientMessageId,
        content,
        attachments,
      );
    }
  }
  return [
    ...messages,
    {
      id: clientId("user"),
      role: "user",
      content,
      status: "complete",
      toolCalls: [],
      ...(event.clientMessageId === undefined ? {} : { clientMessageId: event.clientMessageId }),
      ...(attachments.length === 0 ? {} : { attachments }),
    },
  ];
}

function confirmUserMessageAt(
  messages: ChatMessageView[],
  index: number,
  clientMessageId: string | undefined,
  content: string,
  attachments: AttachmentData[],
): ChatMessageView[] {
  return messages.map((message, messageIndex) => {
    if (messageIndex !== index || message.role !== "user") {
      return message;
    }
    const { attachments: existingAttachments, pendingKind: _pendingKind, ...rest } = message;
    const nextAttachments = attachments.length === 0 ? (existingAttachments ?? []) : attachments;
    return {
      ...rest,
      content,
      status: "complete",
      toolCalls: [],
      ...(clientMessageId === undefined ? {} : { clientMessageId }),
      ...(nextAttachments.length === 0 ? {} : { attachments: nextAttachments }),
    };
  });
}

type TranscriptStreamEvent =
  | Extract<ChatStreamEvent, { type: "assistant.delta" }>
  | Extract<ChatStreamEvent, { type: "assistant.reasoning" }>
  | Extract<ChatStreamEvent, { type: "model.response" }>
  | Extract<ChatStreamEvent, { type: "tool.call.started" }>
  | Extract<ChatStreamEvent, { type: "tool.output" }>
  | Extract<ChatStreamEvent, { type: "tool.call.completed" }>;

export type TranscriptUpdate = (messages: ChatMessageView[]) => ChatMessageView[];

export function transcriptUpdateForStreamEvent(
  event: TranscriptStreamEvent,
  runId: string | null,
  usage?: TokenUsage,
): TranscriptUpdate {
  switch (event.type) {
    case "assistant.delta":
      return (messages) =>
        appendAssistantDelta(messages, runId, event.iteration, event.contentDelta);
    case "assistant.reasoning":
      return (messages) =>
        appendAssistantReasoning(messages, runId, event.iteration, event.reasoningDelta);
    case "model.response":
      return (messages) =>
        finalizeAssistantResponse(
          messages,
          runId,
          event.iteration,
          event.content,
          event.toolCalls,
          usage,
          event.reasoning,
        );
    case "tool.call.started":
      return (messages) => startToolCall(messages, runId, event);
    case "tool.output":
      return (messages) =>
        appendToolOutput(messages, event.toolCallId, event.stream, event.textDelta);
    case "tool.call.completed":
      return (messages) => completeToolCall(messages, event.toolCallId, event.result);
  }
}

export function markPendingMessagesErrored(messages: ChatMessageView[]): ChatMessageView[] {
  return messages.map((message) => ({
    ...message,
    status: message.status === "streaming" ? "error" : message.status,
    toolCalls: message.toolCalls.map((toolCall) => ({
      ...toolCall,
      status: toolCall.status === "running" ? "error" : toolCall.status,
    })),
  }));
}

export function markPendingMessagesComplete(messages: ChatMessageView[]): ChatMessageView[] {
  return messages.map((message) => ({
    ...message,
    status: message.status === "streaming" ? "complete" : message.status,
    toolCalls: message.toolCalls.map((toolCall) => ({
      ...toolCall,
      status: toolCall.status === "running" ? "complete" : toolCall.status,
    })),
  }));
}

function mergeToolCalls(
  existing: ChatToolCallView[],
  incoming: ChatToolCallView[],
): ChatToolCallView[] {
  const merged = [...existing];
  for (const toolCall of incoming) {
    const index = merged.findIndex((candidate) => candidate.id === toolCall.id);
    if (index === -1) {
      merged.push(toolCall);
      continue;
    }
    const current = merged[index];
    if (current === undefined) {
      merged.push(toolCall);
      continue;
    }
    merged[index] = {
      ...current,
      name: toolCall.name,
      argumentsText: toolCall.argumentsText,
      status:
        current.status === "complete" || current.status === "error"
          ? current.status
          : toolCall.status,
    };
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Persisted-message → in-memory transcript converter. Used when the URL-driven
// session-load effect resolves; the result becomes the seed for live SSE
// updates that follow.
// ---------------------------------------------------------------------------

/**
 * Convert the server's persisted message list into the in-memory transcript.
 *
 * When `existing` is supplied (the current in-flight transcript), persisted
 * entries are aligned to the existing streaming entries by ordered role-match.
 * Aligned entries inherit the streaming entry's id AND its `runId`/`iteration`
 * metadata. The id alignment keeps React keys stable across a streaming →
 * loaded transition; carrying `runId`/`iteration` forward means subsequent SSE
 * deltas for that turn still find the entry via `appendAssistantDelta` instead
 * of creating a duplicate alongside the just-loaded persisted message.
 */
export function messagesToTranscript(
  messages: ChatMessageSummary[],
  existing?: ChatMessageView[],
): ChatMessageView[] {
  const transcript: ChatMessageView[] = [];
  const existingSystemMessages = existing?.filter((message) => message.role === "system") ?? [];
  const existingByRole = {
    user: collectByRole(existing, "user"),
    assistant: collectByRole(existing, "assistant"),
  };
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      const matched = existingByRole.user.shift();
      const attachments = attachmentsToAttachmentData(message.attachments);
      transcript.push({
        id: matched?.id ?? `stored-user-${message.id}`,
        role: "user",
        content: message.content,
        status: "complete",
        toolCalls: [],
        ...(attachments.length === 0 ? {} : { attachments }),
      });
      continue;
    }
    if (message.role === "assistant") {
      const matched = existingByRole.assistant.shift();
      transcript.push({
        id: matched?.id ?? `stored-assistant-${message.id}`,
        role: "assistant",
        ...(matched?.runId === undefined ? {} : { runId: matched.runId }),
        ...(matched?.iteration === undefined ? {} : { iteration: matched.iteration }),
        content: message.content,
        status: "complete",
        toolCalls: storedToolCalls(message.toolCalls),
        ...(message.usage === null ? {} : { usage: message.usage }),
      });
      continue;
    }
    if (message.role === "tool" && message.toolCallId !== null) {
      attachStoredToolResult(transcript, message.toolCallId, parseJsonValue(message.content));
    }
  }
  return existingSystemMessages.length === 0
    ? transcript
    : [...transcript, ...existingSystemMessages];
}

function collectByRole(
  transcript: ChatMessageView[] | undefined,
  role: "user" | "assistant",
): ChatMessageView[] {
  if (transcript === undefined) {
    return [];
  }
  return transcript.filter((message) => message.role === role);
}

function attachStoredToolResult(
  transcript: ChatMessageView[],
  toolCallId: string,
  result: unknown,
): void {
  const status: ToolStatus = isToolErrorResult(result) ? "error" : "complete";
  for (let index = transcript.length - 1; index >= 0; index -= 1) {
    const message = transcript[index];
    if (message?.role !== "assistant") {
      continue;
    }
    if (!message.toolCalls.some((toolCall) => toolCall.id === toolCallId)) {
      continue;
    }
    message.toolCalls = message.toolCalls.map((toolCall) =>
      toolCall.id === toolCallId ? { ...toolCall, status, result } : toolCall,
    );
    return;
  }
  transcript.push({
    id: `stored-tool-${toolCallId}`,
    role: "assistant",
    content: "",
    status: "complete",
    toolCalls: [{ id: toolCallId, name: "tool", argumentsText: "", status, result }],
  });
}

function storedToolCalls(value: ChatMessageSummary["toolCalls"]): ChatToolCallView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const toolCalls: ChatToolCallView[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      continue;
    }
    const id = entry.id;
    const name = entry.name;
    const argumentsText = entry.argumentsText;
    if (typeof id !== "string" || typeof name !== "string") {
      continue;
    }
    toolCalls.push({
      id,
      name,
      argumentsText: typeof argumentsText === "string" ? argumentsText : "",
      status: toolStatus(entry.status) ?? "running",
      ...(typeof entry.summary === "string" ? { summary: entry.summary } : {}),
      ...(entry.resultAvailable === true ? { resultAvailable: true } : {}),
    });
  }
  return toolCalls;
}

function toolStatus(value: unknown): ToolStatus | null {
  return value === "running" || value === "complete" || value === "error" ? value : null;
}

// ---------------------------------------------------------------------------
// Lookup primitives.
// ---------------------------------------------------------------------------

function runScope(runId: string | null): Pick<ChatMessageView, "runId"> | Record<string, never> {
  return runId === null ? {} : { runId };
}

function findAssistantByRunIteration(
  messages: ChatMessageView[],
  runId: string | null,
  iteration: number,
): number {
  if (runId === null) {
    return -1;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (
      message?.role === "assistant" &&
      message.runId === runId &&
      message.iteration === iteration
    ) {
      return index;
    }
  }
  return -1;
}

function findMessageWithTool(messages: ChatMessageView[], toolCallId: string): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.toolCalls.some((toolCall) => toolCall.id === toolCallId)) {
      return index;
    }
  }
  return -1;
}

function findLastAssistantForRun(messages: ChatMessageView[], runId: string | null): number {
  if (runId === null) {
    return -1;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant" && message.runId === runId) {
      return index;
    }
  }
  return -1;
}

function isToolErrorResult(value: unknown): boolean {
  return isRecord(value) && value.ok === false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function attachmentsToAttachmentData(value: unknown): AttachmentData[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const attachments: AttachmentData[] = [];
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    if (
      item.type === "file" &&
      typeof item.mediaType === "string" &&
      typeof item.url === "string"
    ) {
      attachments.push({
        id: typeof item.id === "string" ? item.id : clientId("stored-att"),
        type: "file",
        mediaType: item.mediaType,
        url: item.url,
        ...(typeof item.filename === "string" ? { filename: item.filename } : {}),
      });
      continue;
    }
    if (item.kind !== "image") {
      continue;
    }
    const mimeType = typeof item.mimeType === "string" ? item.mimeType : "image/png";
    const dataBase64 = typeof item.dataBase64 === "string" ? item.dataBase64 : "";
    if (dataBase64 === "") {
      continue;
    }
    attachments.push({
      id: clientId("stored-att"),
      type: "file",
      mediaType: mimeType,
      filename: typeof item.name === "string" ? item.name : "Image",
      url: `data:${mimeType};base64,${dataBase64}`,
    });
  }
  return attachments;
}

function parseJsonValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

// ---------------------------------------------------------------------------
// String + ID helpers.
// ---------------------------------------------------------------------------

export function clientId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export interface FriendlyChatError {
  title: string;
  message: string;
  requestId: string | null;
  retryable: boolean;
}

export function friendlyChatError(rawMessage: string): FriendlyChatError {
  const parsed = parseModelHttpError(rawMessage);
  if (parsed !== null) {
    const title =
      parsed.status === 429
        ? "Model rate limit reached"
        : parsed.provider === "Anthropic"
          ? "Anthropic request failed"
          : "Model request failed";
    return {
      title,
      message: parsed.detail,
      requestId: parsed.requestId,
      retryable: parsed.status === 429 || parsed.status >= 500,
    };
  }
  return {
    title: "Run failed",
    message: rawMessage,
    requestId: null,
    retryable:
      /\b(408|409|429|500|502|503|504)\b|rate.?limit|too many requests|overloaded|service.?unavailable/i.test(
        rawMessage,
      ),
  };
}

function parseModelHttpError(
  rawMessage: string,
): { provider: string; status: number; detail: string; requestId: string | null } | null {
  const match =
    /^(?<provider>Anthropic|Model|Codex) request failed with HTTP (?<status>\d{3})(?: \((?<type>[^)]+)\))?: (?<detail>[\s\S]*?)(?: \(request (?<requestId>[^)]+)\))?$/.exec(
      rawMessage,
    );
  if (match?.groups === undefined) {
    return null;
  }
  const status = Number.parseInt(match.groups.status ?? "", 10);
  if (!Number.isFinite(status)) {
    return null;
  }
  return {
    provider: match.groups.provider ?? "Model",
    status,
    detail: match.groups.detail ?? rawMessage,
    requestId: match.groups.requestId ?? null,
  };
}

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function agentCompletionMessage(status: string, stoppedReason?: string): string | null {
  if (status === "interrupted") {
    return stoppedReason === "cancelled"
      ? null
      : `Run was interrupted${stoppedReason === undefined ? "" : ` (${stoppedReason})`}.`;
  }
  if (status === "failed") {
    return `Run failed${stoppedReason === undefined ? "" : ` (${stoppedReason})`}.`;
  }
  return `Run ended with status ${status}${stoppedReason === undefined ? "" : ` (${stoppedReason})`}.`;
}

export function sanitizeDisplayText(value: string): string {
  const sanitized = value
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping ANSI escape sequences from titles
    .replace(
      // eslint-disable-next-line no-control-regex
      /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][\s\S]*?(?:\x07|\x1b\\)|[PX^_][\s\S]*?\x1b\\|[@-Z\\-_])/g,
      "",
    )
    // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping bare control characters
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "");
  return sanitized.trim() === "" ? "Untitled session" : sanitized;
}

export function toChatImageAttachment(attachment: AttachmentData): ChatImageAttachment | null {
  if (attachment.type !== "file") {
    return null;
  }
  const dataUrl = attachment.url;
  const commaIndex = dataUrl.indexOf(",");
  if (!dataUrl.startsWith("data:") || commaIndex === -1) {
    return null;
  }
  const dataBase64 = dataUrl.slice(commaIndex + 1);
  const mimeType = attachment.mediaType ?? "application/octet-stream";
  const result: ChatImageAttachment = { kind: "image", mimeType, dataBase64 };
  if (attachment.filename !== undefined) {
    result.name = attachment.filename;
  }
  return result;
}
