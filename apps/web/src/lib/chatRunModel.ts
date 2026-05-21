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
  result?: unknown;
}

export interface ChatMessageView {
  id: string;
  role: "user" | "assistant";
  content: string;
  status: MessageStatus;
  toolCalls: ChatToolCallView[];
  runId?: string;
  iteration?: number;
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

export function finalizeAssistantResponse(
  messages: ChatMessageView[],
  runId: string | null,
  iteration: number,
  content: string,
  toolCalls: Array<{ id: string; name: string; argumentsText: string }>,
  usage: TokenUsage | undefined,
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

export function messagesToTranscript(messages: ChatMessageSummary[]): ChatMessageView[] {
  const transcript: ChatMessageView[] = [];
  for (const message of messages) {
    if (message.role === "system") {
      continue;
    }
    if (message.role === "user") {
      transcript.push({
        id: `stored-user-${message.id}`,
        role: "user",
        content: message.content,
        status: "complete",
        toolCalls: [],
      });
      continue;
    }
    if (message.role === "assistant") {
      transcript.push({
        id: `stored-assistant-${message.id}`,
        role: "assistant",
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
  return transcript;
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
      status: "running",
    });
  }
  return toolCalls;
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

export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

export function agentCompletionMessage(status: string, stoppedReason?: string): string {
  if (status === "interrupted") {
    return stoppedReason === "cancelled"
      ? "Run was interrupted before it finished."
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

// ---------------------------------------------------------------------------
// Attachment helpers.
// ---------------------------------------------------------------------------

export function readFileAsAttachment(file: File): Promise<AttachmentData | null> {
  if (file.size > MAX_ATTACHMENT_BYTES || !file.type.startsWith("image/")) {
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"));
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : "";
      if (url === "") {
        resolve(null);
        return;
      }
      resolve({
        id: clientId("att"),
        type: "file",
        mediaType: file.type,
        filename: file.name,
        url,
      });
    };
    reader.readAsDataURL(file);
  });
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
