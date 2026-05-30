import type { JsonObject } from "@strata/core";
import type { ToolMetadata } from "@strata/tools";
import type { ChatGptCredentials } from "./authStore.js";
import { ModelAdapterError } from "./model.js";
import {
  getModelCapabilities,
  type ModelCapabilities,
  mapThinkingLevel,
} from "./modelCapabilities.js";
import { createProviderToolNameMap } from "./providerToolNames.js";
import { parseSseEvents } from "./sse.js";
import type {
  AgentMessage,
  AgentToolCall,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ThinkingLevel,
} from "./types.js";

export interface OpenAICodexModelOptions {
  credentials: ChatGptCredentials;
  model: string;
  baseUrl?: string;
  name?: string;
  fetchImpl?: typeof fetch;
  capabilities?: ModelCapabilities;
  retryPolicy?: OpenAICodexRetryPolicy;
}

export interface OpenAICodexRetryPolicy {
  /** Total attempts, including the first request. */
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  backoffFactor?: number;
}

interface ResponseEvent {
  type?: unknown;
  [key: string]: unknown;
}

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const DEFAULT_CODEX_RETRY_POLICY: Required<OpenAICodexRetryPolicy> = {
  maxAttempts: 4,
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  backoffFactor: 2,
};
const RETRYABLE_CODEX_HTTP_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);
const RETRYABLE_CODEX_ERROR_TEXT =
  /rate.?limit|too many requests|overloaded|service.?unavailable|server.?error|internal.?error|network.?error|connection.?error|connection.?refused|connection.?reset|connection.?failure|connection.?lost|econnreset|etimedout|fetch failed|upstream.?connect|reset before headers|socket hang up|other side closed|ended without|stream ended before message_stop|http2 request did not get a response|timed? out|timeout|terminated/i;

export class OpenAICodexModelAdapter implements ModelAdapter {
  readonly name: string;
  private readonly credentials: ChatGptCredentials;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retryPolicy: Required<OpenAICodexRetryPolicy>;
  readonly capabilities: ModelCapabilities;

  constructor(options: OpenAICodexModelOptions) {
    this.credentials = options.credentials;
    this.model = options.model;
    this.name = options.name ?? `openai-codex:${options.model}`;
    this.baseUrl = (options.baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.retryPolicy = normalizeCodexRetryPolicy(options.retryPolicy);
    this.capabilities = options.capabilities ?? getModelCapabilities("openai-codex", options.model);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const toolNameMap = createProviderToolNameMap(request.tools);
    const body = buildCodexRequestBody(
      this.model,
      request,
      toolNameMap.canonicalToProvider,
      this.capabilities,
    );
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.credentials.accessToken}`,
        "chatgpt-account-id": this.credentials.accountId,
        originator: "strata",
        "openai-beta": "responses=experimental",
        accept: "text/event-stream",
        "content-type": "application/json",
        "user-agent": "strata",
      },
      body: JSON.stringify(body),
    };
    if (request.signal !== undefined) {
      init.signal = request.signal;
    }
    const response = await fetchCodexWithRetries(
      this.fetchImpl,
      resolveCodexResponsesUrl(this.baseUrl),
      init,
      this.retryPolicy,
    );

    if (!response.ok) {
      throw new ModelAdapterError(
        "codex_http_error",
        `Codex request failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }
    if (response.body === null) {
      throw new ModelAdapterError(
        "codex_response_invalid",
        "Codex response did not include a body",
      );
    }

    return parseCodexSseResponse(
      parseSseEvents<ResponseEvent>(response),
      toolNameMap.providerToCanonical,
      request.onAssistantDelta,
      request.onReasoningDelta,
    );
  }
}

async function fetchCodexWithRetries(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  policy: Required<OpenAICodexRetryPolicy>,
): Promise<Response> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    if (isAbortSignalAborted(init.signal)) {
      throw new ModelAdapterError("codex_request_aborted", "Codex request was aborted");
    }

    try {
      const response = await fetchImpl(url, init);
      if (response.ok) {
        return response;
      }

      const errorText = await response.text();
      if (attempt < policy.maxAttempts && isRetryableCodexHttpError(response.status, errorText)) {
        await sleepForCodexRetry(codexRetryDelayMs(attempt, policy, response.headers), init.signal);
        continue;
      }

      throw new ModelAdapterError(
        "codex_http_error",
        `Codex request failed with HTTP ${response.status}: ${errorText}`,
      );
    } catch (error: unknown) {
      if (isAbortSignalAborted(init.signal)) {
        throw new ModelAdapterError("codex_request_aborted", "Codex request was aborted");
      }
      if (error instanceof ModelAdapterError) {
        throw error;
      }

      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < policy.maxAttempts && isRetryableCodexFetchError(lastError)) {
        await sleepForCodexRetry(codexRetryDelayMs(attempt, policy), init.signal);
        continue;
      }

      throw new ModelAdapterError(
        "codex_network_error",
        `Codex request failed: ${lastError.message}`,
      );
    }
  }

  throw new ModelAdapterError(
    "codex_network_error",
    `Codex request failed after retries${lastError === undefined ? "" : `: ${lastError.message}`}`,
  );
}

function normalizeCodexRetryPolicy(
  input: OpenAICodexRetryPolicy | undefined,
): Required<OpenAICodexRetryPolicy> {
  return {
    maxAttempts: boundedInteger(input?.maxAttempts, DEFAULT_CODEX_RETRY_POLICY.maxAttempts, 1, 10),
    initialDelayMs: boundedInteger(
      input?.initialDelayMs,
      DEFAULT_CODEX_RETRY_POLICY.initialDelayMs,
      0,
      60_000,
    ),
    maxDelayMs: boundedInteger(
      input?.maxDelayMs,
      DEFAULT_CODEX_RETRY_POLICY.maxDelayMs,
      0,
      120_000,
    ),
    backoffFactor:
      typeof input?.backoffFactor === "number" &&
      Number.isFinite(input.backoffFactor) &&
      input.backoffFactor >= 1
        ? Math.min(input.backoffFactor, 10)
        : DEFAULT_CODEX_RETRY_POLICY.backoffFactor,
  };
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.floor(value)));
}

function isRetryableCodexHttpError(status: number, errorText: string): boolean {
  return RETRYABLE_CODEX_HTTP_STATUSES.has(status) || RETRYABLE_CODEX_ERROR_TEXT.test(errorText);
}

function isRetryableCodexFetchError(error: Error): boolean {
  return RETRYABLE_CODEX_ERROR_TEXT.test(error.message);
}

function codexRetryDelayMs(
  attempt: number,
  policy: Required<OpenAICodexRetryPolicy>,
  headers?: Headers,
): number {
  const serverDelayMs = headers === undefined ? undefined : retryAfterDelayMs(headers);
  const rawDelay =
    serverDelayMs ??
    Math.round(policy.initialDelayMs * policy.backoffFactor ** Math.max(0, attempt - 1));
  return Math.min(policy.maxDelayMs, Math.max(0, rawDelay));
}

function retryAfterDelayMs(headers: Headers): number | undefined {
  const retryAfterMs = headers.get("retry-after-ms");
  if (retryAfterMs !== null) {
    const millis = Number(retryAfterMs);
    if (Number.isFinite(millis)) {
      return millis;
    }
  }

  const retryAfter = headers.get("retry-after");
  if (retryAfter === null) {
    return undefined;
  }
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const date = Date.parse(retryAfter);
  return Number.isNaN(date) ? undefined : date - Date.now();
}

async function sleepForCodexRetry(
  delayMs: number,
  signal: RequestInit["signal"] | undefined,
): Promise<void> {
  if (delayMs <= 0 || isAbortSignalAborted(signal)) {
    return;
  }
  await new Promise<void>((resolve) => {
    let timeout: ReturnType<typeof setTimeout>;
    const done = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    timeout = setTimeout(done, delayMs);
    signal?.addEventListener("abort", done, { once: true });
  });
}

function isAbortSignalAborted(signal: RequestInit["signal"] | undefined): boolean {
  return signal !== undefined && signal !== null && signal.aborted;
}

function buildCodexRequestBody(
  model: string,
  request: ModelRequest,
  canonicalToProvider: Map<string, string>,
  capabilities: ModelCapabilities,
): JsonObject {
  const instructions = request.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const input = request.messages
    .filter((message) => message.role !== "system")
    .flatMap((message, index) => toResponsesInputItems(message, index, canonicalToProvider));

  const body: JsonObject = {
    model,
    store: false,
    stream: true,
    input,
    text: { verbosity: "low" },
    parallel_tool_calls: true,
  };
  if (instructions !== "") {
    body.instructions = instructions;
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => toResponsesTool(tool, canonicalToProvider));
    body.tool_choice = "auto";
  }
  if (
    capabilities.reasoning &&
    request.reasoningEffort !== undefined &&
    request.reasoningEffort !== "off"
  ) {
    const effort = mapResponsesEffort(capabilities, request.reasoningEffort);
    if (effort !== null) {
      body.reasoning = { effort, summary: "auto" };
    }
  }
  return body;
}

function mapResponsesEffort(
  capabilities: ModelCapabilities,
  level: Exclude<ThinkingLevel, "off">,
): string | null {
  return mapThinkingLevel(capabilities, level) ?? level;
}

function toResponsesInputItems(
  message: AgentMessage,
  index: number,
  canonicalToProvider: Map<string, string>,
): JsonObject[] {
  if (message.role === "user") {
    const content: JsonObject[] = [];
    if (message.content !== "") {
      content.push({ type: "input_text", text: message.content });
    }
    for (const attachment of message.attachments ?? []) {
      if (attachment.kind === "image") {
        content.push({
          type: "input_image",
          image_url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`,
          detail: "auto",
        });
      }
    }
    if (content.length === 0) {
      content.push({ type: "input_text", text: "" });
    }
    return [{ role: "user", content }];
  }

  if (message.role === "tool") {
    const [callId] = splitToolCallId(message.toolCallId ?? "");
    return [
      {
        type: "function_call_output",
        call_id: callId,
        output: message.content,
      },
    ];
  }

  if (message.role !== "assistant") {
    return [];
  }

  const items: JsonObject[] = [];
  if (message.content.trim() !== "") {
    items.push({
      type: "message",
      role: "assistant",
      status: "completed",
      id: `msg_${index}`,
      content: [{ type: "output_text", text: message.content, annotations: [] }],
    });
  }
  for (const toolCall of message.toolCalls ?? []) {
    const [callId, itemId] = splitToolCallId(toolCall.id);
    const item: JsonObject = {
      type: "function_call",
      call_id: callId,
      name: canonicalToProvider.get(toolCall.name) ?? toolCall.name,
      arguments: toolCall.argumentsText,
    };
    if (itemId !== undefined) {
      item.id = itemId;
    }
    items.push(item);
  }
  return items;
}

function toResponsesTool(tool: ToolMetadata, canonicalToProvider: Map<string, string>): JsonObject {
  return {
    type: "function",
    name: canonicalToProvider.get(tool.name) ?? tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
    strict: false,
  };
}

async function parseCodexSseResponse(
  events: AsyncIterable<ResponseEvent>,
  providerToCanonical: Map<string, string>,
  onAssistantDelta?: (delta: string) => void,
  onReasoningDelta?: (delta: string) => void,
): Promise<ModelResponse> {
  let content = "";
  let reasoning = "";
  let reasoningSignature: string | undefined;
  let finishReason = "unknown";
  let providerResponseId: string | undefined;
  let usage: JsonObject | undefined;
  let currentTool:
    | { callId: string; itemId?: string; name: string; argumentsText: string }
    | undefined;
  const toolCalls: AgentToolCall[] = [];
  // Emit a blank line between successive reasoning summary parts so multi-part
  // summaries read as paragraphs rather than running together.
  const pushReasoning = (delta: string): void => {
    reasoning += delta;
    onReasoningDelta?.(delta);
  };

  for await (const event of events) {
    const type = typeof event.type === "string" ? event.type : "";

    if (type === "response.created") {
      const response = event.response as { id?: unknown } | undefined;
      if (typeof response?.id === "string") {
        providerResponseId = response.id;
      }
    } else if (type === "response.output_text.delta") {
      if (typeof event.delta === "string") {
        content += event.delta;
        onAssistantDelta?.(event.delta);
      }
    } else if (
      type === "response.reasoning_summary_text.delta" ||
      type === "response.reasoning_text.delta"
    ) {
      if (typeof event.delta === "string") {
        pushReasoning(event.delta);
      }
    } else if (type === "response.reasoning_summary_part.added") {
      if (reasoning !== "") {
        pushReasoning("\n\n");
      }
    } else if (type === "response.output_item.added") {
      const item = event.item as
        | { type?: unknown; call_id?: unknown; id?: unknown; name?: unknown; arguments?: unknown }
        | undefined;
      if (
        item?.type === "function_call" &&
        typeof item.call_id === "string" &&
        typeof item.name === "string"
      ) {
        currentTool = {
          callId: item.call_id,
          name: providerToCanonical.get(item.name) ?? item.name,
          argumentsText: typeof item.arguments === "string" ? item.arguments : "",
        };
        if (typeof item.id === "string") {
          currentTool.itemId = item.id;
        }
      }
    } else if (type === "response.function_call_arguments.delta") {
      if (currentTool !== undefined && typeof event.delta === "string") {
        currentTool.argumentsText += event.delta;
      }
    } else if (type === "response.function_call_arguments.done") {
      if (currentTool !== undefined && typeof event.arguments === "string") {
        currentTool.argumentsText = event.arguments;
      }
    } else if (type === "response.output_item.done") {
      const item = event.item as
        | {
            type?: unknown;
            call_id?: unknown;
            id?: unknown;
            name?: unknown;
            arguments?: unknown;
            content?: unknown;
          }
        | undefined;
      if (item?.type === "function_call") {
        const callId = typeof item.call_id === "string" ? item.call_id : currentTool?.callId;
        const itemId = typeof item.id === "string" ? item.id : currentTool?.itemId;
        const providerName = typeof item.name === "string" ? item.name : undefined;
        if (callId !== undefined && providerName !== undefined) {
          const args =
            typeof item.arguments === "string"
              ? item.arguments
              : (currentTool?.argumentsText ?? "{}");
          toolCalls.push({
            id: itemId === undefined ? callId : `${callId}|${itemId}`,
            name: providerToCanonical.get(providerName) ?? providerName,
            argumentsText: args === "" ? "{}" : args,
          });
        }
        currentTool = undefined;
      } else if (item?.type === "message" && content === "") {
        content = extractMessageText(item.content);
      } else if (item?.type === "reasoning") {
        // Preserve the full reasoning item (incl. any encrypted_content) so the
        // next turn can replay it for reasoning continuity.
        reasoningSignature = JSON.stringify(item);
      }
    } else if (
      type === "response.completed" ||
      type === "response.done" ||
      type === "response.incomplete"
    ) {
      const response = event.response as
        | { id?: unknown; status?: unknown; usage?: unknown }
        | undefined;
      if (typeof response?.id === "string") {
        providerResponseId = response.id;
      }
      if (typeof response?.status === "string") {
        finishReason = response.status;
      }
      if (isJsonObject(response?.usage)) {
        usage = response.usage;
      }
    } else if (type === "response.failed") {
      const response = event.response as { error?: { message?: unknown } } | undefined;
      throw new ModelAdapterError(
        "codex_response_failed",
        typeof response?.error?.message === "string"
          ? response.error.message
          : "Codex response failed",
      );
    } else if (type === "error") {
      throw new ModelAdapterError(
        "codex_stream_error",
        typeof event.message === "string" ? event.message : JSON.stringify(event),
      );
    }
  }

  const response: ModelResponse = {
    content,
    toolCalls,
    finishReason:
      toolCalls.length > 0 && finishReason === "completed" ? "tool_calls" : finishReason,
  };
  if (providerResponseId !== undefined) {
    response.providerResponseId = providerResponseId;
  }
  if (usage !== undefined) {
    response.usage = usage;
  }
  if (reasoning !== "") {
    response.reasoning = reasoning;
  }
  if (reasoningSignature !== undefined) {
    response.reasoningSignature = reasoningSignature;
  }
  return response;
}

function resolveCodexResponsesUrl(baseUrl: string): string {
  if (baseUrl.endsWith("/codex/responses")) {
    return baseUrl;
  }
  if (baseUrl.endsWith("/codex")) {
    return `${baseUrl}/responses`;
  }
  return `${baseUrl}/codex/responses`;
}

function splitToolCallId(id: string): [string, string | undefined] {
  const [callId, itemId] = id.split("|", 2);
  return [callId ?? id, itemId];
}

function extractMessageText(content: unknown): string {
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((part: unknown) => {
      if (typeof part !== "object" || part === null) {
        return "";
      }
      const candidate = part as { type?: unknown; text?: unknown; refusal?: unknown };
      if (candidate.type === "output_text" && typeof candidate.text === "string") {
        return candidate.text;
      }
      if (candidate.type === "refusal" && typeof candidate.refusal === "string") {
        return candidate.refusal;
      }
      return "";
    })
    .join("");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
