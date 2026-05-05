import type { JsonObject, JsonValue } from "@cortex/core";
import type { ToolMetadata } from "@cortex/tools";
import type { ChatGptCredentials } from "./authStore.js";
import { ModelAdapterError } from "./model.js";
import { createProviderToolNameMap } from "./providerToolNames.js";
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
}

interface ResponseEvent {
  type?: unknown;
  [key: string]: unknown;
}

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export class OpenAICodexModelAdapter implements ModelAdapter {
  readonly name: string;
  private readonly credentials: ChatGptCredentials;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICodexModelOptions) {
    this.credentials = options.credentials;
    this.model = options.model;
    this.name = options.name ?? `openai-codex:${options.model}`;
    this.baseUrl = (options.baseUrl ?? DEFAULT_CODEX_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const toolNameMap = createProviderToolNameMap(request.tools);
    const body = buildCodexRequestBody(this.model, request, toolNameMap.canonicalToProvider);
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.credentials.accessToken}`,
        "chatgpt-account-id": this.credentials.accountId,
        originator: "cortex",
        "openai-beta": "responses=experimental",
        accept: "text/event-stream",
        "content-type": "application/json",
        "user-agent": "cortex",
      },
      body: JSON.stringify(body),
    };
    if (request.signal !== undefined) {
      init.signal = request.signal;
    }
    const response = await this.fetchImpl(resolveCodexResponsesUrl(this.baseUrl), init);

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

    return parseCodexSseResponse(parseSse(response), toolNameMap.providerToCanonical);
  }
}

function buildCodexRequestBody(
  model: string,
  request: ModelRequest,
  canonicalToProvider: Map<string, string>,
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
    parallel_tool_calls: false,
  };
  if (instructions !== "") {
    body.instructions = instructions;
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => toResponsesTool(tool, canonicalToProvider));
    body.tool_choice = "auto";
  }
  if (request.reasoningEffort !== undefined && request.reasoningEffort !== "off") {
    body.reasoning = { effort: mapResponsesEffort(request.reasoningEffort) };
  }
  return body;
}

function mapResponsesEffort(level: Exclude<ThinkingLevel, "off">): string {
  // The OpenAI responses API accepts minimal|low|medium|high. Pi exposes an
  // additional "xhigh" tier that providers map to their highest setting.
  return level === "xhigh" ? "high" : level;
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
): Promise<ModelResponse> {
  let content = "";
  let finishReason = "unknown";
  let providerResponseId: string | undefined;
  let usage: JsonObject | undefined;
  let currentTool:
    | { callId: string; itemId?: string; name: string; argumentsText: string }
    | undefined;
  const toolCalls: AgentToolCall[] = [];

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
  return response;
}

async function* parseSse(response: Response): AsyncGenerator<ResponseEvent> {
  const reader = response.body?.getReader();
  if (reader === undefined) {
    return;
  }
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let separator = buffer.indexOf("\n\n");
      while (separator !== -1) {
        const chunk = buffer.slice(0, separator);
        buffer = buffer.slice(separator + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trim())
          .join("\n")
          .trim();
        if (data !== "" && data !== "[DONE]") {
          yield JSON.parse(data) as ResponseEvent;
        }
        separator = buffer.indexOf("\n\n");
      }
    }
  } finally {
    reader.releaseLock();
  }
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
