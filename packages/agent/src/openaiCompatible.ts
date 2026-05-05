import type { JsonObject, JsonValue } from "@cortex/core";
import type { ToolMetadata } from "@cortex/tools";
import { ModelAdapterError } from "./model.js";
import { createProviderToolNameMap } from "./providerToolNames.js";
import { parseSseEvents } from "./sse.js";
import type {
  AgentAttachment,
  AgentMessage,
  AgentToolCall,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
} from "./types.js";

export interface OpenAICompatibleChatModelOptions {
  apiKey: string;
  model: string;
  baseUrl?: string;
  name?: string;
  fetchImpl?: typeof fetch;
}

interface OpenAIChatToolCallDelta {
  index?: unknown;
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface OpenAIChatStreamChoice {
  delta?: {
    content?: unknown;
    tool_calls?: OpenAIChatToolCallDelta[];
  };
  finish_reason?: unknown;
}

interface OpenAIChatStreamChunk {
  id?: unknown;
  choices?: OpenAIChatStreamChoice[];
  usage?: JsonObject;
}

export class OpenAICompatibleChatModelAdapter implements ModelAdapter {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenAICompatibleChatModelOptions) {
    this.name = options.name ?? `openai-compatible:${options.model}`;
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.baseUrl = (options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const toolNameMap = createProviderToolNameMap(request.tools);
    const body: JsonObject = {
      model: this.model,
      messages: request.messages.map((message) =>
        toProviderMessage(message, toolNameMap.canonicalToProvider),
      ),
      tools: request.tools.map((tool) => toProviderTool(tool, toolNameMap.canonicalToProvider)),
      tool_choice: request.tools.length > 0 ? "auto" : "none",
      parallel_tool_calls: false,
      // Pi-aligned: stream every request and ask for usage in the trailing
      // chunk so the TUI can render assistant text incrementally.
      stream: true,
      stream_options: { include_usage: true },
    };
    if (request.reasoningEffort !== undefined && request.reasoningEffort !== "off") {
      // chat/completions accepts minimal|low|medium|high; map xhigh -> high.
      body.reasoning_effort =
        request.reasoningEffort === "xhigh" ? "high" : request.reasoningEffort;
    }
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
        accept: "text/event-stream",
      },
      body: JSON.stringify(body),
    };
    if (request.signal !== undefined) {
      init.signal = request.signal;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, init);

    if (!response.ok) {
      throw new ModelAdapterError(
        "model_http_error",
        `Model request failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }
    if (response.body === null) {
      throw new ModelAdapterError(
        "model_response_invalid",
        "Model response did not include a body",
      );
    }

    return parseChatCompletionsStream(
      parseSseEvents<OpenAIChatStreamChunk>(response),
      toolNameMap.providerToCanonical,
      request.onAssistantDelta,
    );
  }
}

/**
 * Pi-aligned chat-completions stream parser. Accumulates text content (with
 * `onAssistantDelta` fan-out for each chunk), tool calls (keyed by the
 * stream `index` so multi-tool turns don't collide), the final
 * `finish_reason`, and the usage payload from the trailing chunk.
 */
async function parseChatCompletionsStream(
  events: AsyncIterable<OpenAIChatStreamChunk>,
  providerToCanonical: Map<string, string>,
  onAssistantDelta: ((delta: string) => void) | undefined,
): Promise<ModelResponse> {
  let content = "";
  let finishReason = "unknown";
  let providerResponseId: string | undefined;
  let usage: JsonObject | undefined;

  // Accumulate tool calls in stream order. Pi keys these by the chunk's
  // `index` field; we mirror that. Within an index, `id` and `name` arrive
  // on the first chunk and `arguments` is appended across subsequent chunks.
  const toolCallsByIndex = new Map<
    number,
    { id: string; name: string; argumentsText: string; order: number }
  >();
  let nextOrder = 0;

  for await (const chunk of events) {
    if (typeof chunk.id === "string" && providerResponseId === undefined) {
      providerResponseId = chunk.id;
    }
    if (chunk.usage !== undefined) {
      usage = chunk.usage;
    }
    const choice = Array.isArray(chunk.choices) ? chunk.choices[0] : undefined;
    if (choice === undefined) continue;

    if (typeof choice.finish_reason === "string") {
      finishReason = choice.finish_reason;
    }
    const delta = choice.delta;
    if (delta === undefined) continue;

    if (typeof delta.content === "string" && delta.content.length > 0) {
      content += delta.content;
      onAssistantDelta?.(delta.content);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const toolCall of delta.tool_calls) {
        const index = typeof toolCall.index === "number" ? toolCall.index : 0;
        let entry = toolCallsByIndex.get(index);
        if (entry === undefined) {
          entry = {
            id: typeof toolCall.id === "string" ? toolCall.id : "",
            name: "",
            argumentsText: "",
            order: nextOrder,
          };
          nextOrder += 1;
          toolCallsByIndex.set(index, entry);
        }
        if (typeof toolCall.id === "string" && toolCall.id !== "" && entry.id === "") {
          entry.id = toolCall.id;
        }
        const fnName = toolCall.function?.name;
        if (typeof fnName === "string" && fnName !== "" && entry.name === "") {
          entry.name = fnName;
        }
        const fnArgs = toolCall.function?.arguments;
        if (typeof fnArgs === "string" && fnArgs.length > 0) {
          entry.argumentsText += fnArgs;
        }
      }
    }
  }

  const toolCalls: AgentToolCall[] = Array.from(toolCallsByIndex.values())
    .sort((a, b) => a.order - b.order)
    .map((entry, idx) => ({
      id: entry.id !== "" ? entry.id : `tool_call_${idx + 1}`,
      name:
        providerToCanonical.get(entry.name) ?? (entry.name !== "" ? entry.name : "unknown.tool"),
      argumentsText: entry.argumentsText !== "" ? entry.argumentsText : "{}",
    }));

  const normalized: ModelResponse = {
    content,
    toolCalls,
    finishReason,
  };
  if (providerResponseId !== undefined) {
    normalized.providerResponseId = providerResponseId;
  }
  if (usage !== undefined) {
    normalized.usage = usage;
  }
  return normalized;
}

function toProviderMessage(message: AgentMessage, toolNameMap: Map<string, string>): JsonObject {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content,
    };
  }

  // chat/completions accepts content as either a plain string OR an array of
  // content parts (text + image_url) when multimodal input is needed.
  const hasAttachments = message.attachments !== undefined && message.attachments.length > 0;
  const providerMessage: JsonObject = {
    role: message.role,
    content: hasAttachments
      ? buildChatCompletionsContentParts(message.content, message.attachments ?? [])
      : message.content,
  };

  if (message.toolCalls !== undefined && message.toolCalls.length > 0) {
    providerMessage.tool_calls = message.toolCalls.map((toolCall) => ({
      id: toolCall.id,
      type: "function",
      function: {
        name: toolNameMap.get(toolCall.name) ?? toolCall.name,
        arguments: toolCall.argumentsText,
      },
    }));
  }

  return providerMessage;
}

function buildChatCompletionsContentParts(
  text: string,
  attachments: readonly AgentAttachment[],
): JsonValue[] {
  const parts: JsonValue[] = [];
  if (text !== "") {
    parts.push({ type: "text", text });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      parts.push({
        type: "image_url",
        image_url: { url: `data:${attachment.mimeType};base64,${attachment.dataBase64}` },
      });
    }
  }
  return parts;
}

function toProviderTool(tool: ToolMetadata, toolNameMap: Map<string, string>): JsonObject {
  return {
    type: "function",
    function: {
      name: toolNameMap.get(tool.name) ?? tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  };
}
