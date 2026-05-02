import type { JsonObject, JsonValue } from "@cortex/core";
import type { ToolMetadata } from "@cortex/tools";
import { ModelAdapterError } from "./model.js";
import { createProviderToolNameMap } from "./providerToolNames.js";
import type {
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

interface OpenAIChatToolCall {
  id?: unknown;
  type?: unknown;
  function?: {
    name?: unknown;
    arguments?: unknown;
  };
}

interface OpenAIChatMessage {
  content?: unknown;
  tool_calls?: OpenAIChatToolCall[];
}

interface OpenAIChatChoice {
  message?: OpenAIChatMessage;
  finish_reason?: unknown;
}

interface OpenAIChatResponse {
  id?: unknown;
  choices?: OpenAIChatChoice[];
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
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        messages: request.messages.map((message) =>
          toProviderMessage(message, toolNameMap.canonicalToProvider),
        ),
        tools: request.tools.map((tool) => toProviderTool(tool, toolNameMap.canonicalToProvider)),
        tool_choice: request.tools.length > 0 ? "auto" : "none",
        parallel_tool_calls: false,
      }),
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

    const payload = (await response.json()) as OpenAIChatResponse;
    const choice = payload.choices?.[0];
    const message = choice?.message;
    if (choice === undefined || message === undefined) {
      throw new ModelAdapterError(
        "model_response_invalid",
        "Model response did not include a choice",
      );
    }

    const normalized: ModelResponse = {
      content: normalizeContent(message.content),
      toolCalls: normalizeToolCalls(message.tool_calls ?? [], toolNameMap.providerToCanonical),
      finishReason: typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown",
    };
    if (typeof payload.id === "string") {
      normalized.providerResponseId = payload.id;
    }
    if (payload.usage !== undefined) {
      normalized.usage = payload.usage;
    }
    return normalized;
  }
}

function toProviderMessage(message: AgentMessage, toolNameMap: Map<string, string>): JsonObject {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId ?? "",
      content: message.content,
    };
  }

  const providerMessage: JsonObject = {
    role: message.role,
    content: message.content,
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

function normalizeContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (content === null || content === undefined) {
    return "";
  }
  return JSON.stringify(content);
}

function normalizeToolCalls(
  toolCalls: OpenAIChatToolCall[],
  providerToCanonical: Map<string, string>,
): AgentToolCall[] {
  return toolCalls.map((toolCall, index) => {
    const providerName = toolCall.function?.name;
    const id = toolCall.id;
    const args = toolCall.function?.arguments;

    return {
      id: typeof id === "string" && id !== "" ? id : `tool_call_${index + 1}`,
      name:
        typeof providerName === "string"
          ? (providerToCanonical.get(providerName) ?? providerName)
          : "unknown.tool",
      argumentsText: typeof args === "string" ? args : "{}",
    };
  });
}
