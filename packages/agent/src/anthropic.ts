import type { JsonObject, JsonValue } from "@strata/core";
import type { ToolMetadata } from "@strata/tools";
import type { AnthropicCredentials } from "./authStore.js";
import { ModelAdapterError } from "./model.js";
import {
  getModelCapabilities,
  type ModelCapabilities,
  mapThinkingLevel,
} from "./modelCapabilities.js";
import { createProviderToolNameMap } from "./providerToolNames.js";
import { parseSseEvents } from "./sse.js";
import type {
  AgentAttachment,
  AgentMessage,
  AgentToolCall,
  ModelAdapter,
  ModelRequest,
  ModelResponse,
  ThinkingLevel,
} from "./types.js";

export interface AnthropicModelOptions {
  /** OAuth (Claude Code) credentials. Provide this or `apiKey`. */
  credentials?: AnthropicCredentials;
  /** Anthropic API key (`x-api-key`). Provide this or `credentials`. */
  apiKey?: string;
  model: string;
  baseUrl?: string;
  name?: string;
  fetchImpl?: typeof fetch;
  capabilities?: ModelCapabilities;
}

/**
 * How the adapter authenticates. OAuth mimics Claude Code (oauth beta headers +
 * Claude Code system identity); a plain API key is a standard Anthropic API
 * caller and must NOT impersonate Claude Code.
 */
type AnthropicAuth = { kind: "oauth"; accessToken: string } | { kind: "apiKey"; apiKey: string };

function resolveAnthropicAuth(options: AnthropicModelOptions): AnthropicAuth {
  if (options.credentials !== undefined) {
    return { kind: "oauth", accessToken: options.credentials.accessToken };
  }
  if (options.apiKey !== undefined && options.apiKey.trim() !== "") {
    return { kind: "apiKey", apiKey: options.apiKey };
  }
  throw new ModelAdapterError(
    "anthropic_auth_missing",
    "Anthropic adapter requires OAuth credentials or an API key.",
  );
}

function anthropicAuthHeaders(auth: AnthropicAuth): Record<string, string> {
  if (auth.kind === "oauth") {
    return {
      authorization: `Bearer ${auth.accessToken}`,
      "anthropic-beta": ANTHROPIC_OAUTH_BETA,
      "anthropic-dangerous-direct-browser-access": "true",
      "user-agent": `claude-cli/${CLAUDE_CODE_VERSION} (external, cli)`,
      "x-app": "cli",
    };
  }
  return { "x-api-key": auth.apiKey };
}

interface AnthropicStreamEvent {
  type?: unknown;
  [key: string]: unknown;
}

const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_MAX_TOKENS = 8192;
const CLAUDE_CODE_VERSION = "2.1.85";
const CLAUDE_CODE_SYSTEM_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";
const ANTHROPIC_OAUTH_BETA = "claude-code-20250219,oauth-2025-04-20";
const ANTHROPIC_THINKING_DISPLAY = "summarized";

type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";

export class AnthropicModelAdapter implements ModelAdapter {
  readonly name: string;
  private readonly auth: AnthropicAuth;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  readonly capabilities: ModelCapabilities;

  constructor(options: AnthropicModelOptions) {
    this.auth = resolveAnthropicAuth(options);
    this.model = options.model;
    this.name = options.name ?? `anthropic-claude:${options.model}`;
    this.baseUrl = (options.baseUrl ?? DEFAULT_ANTHROPIC_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.capabilities =
      options.capabilities ?? getModelCapabilities("anthropic-claude", options.model);
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const toolNameMap = createProviderToolNameMap(request.tools);
    const body = buildAnthropicRequestBody(
      this.model,
      request,
      toolNameMap.canonicalToProvider,
      this.auth.kind === "oauth",
      this.capabilities,
    );
    const init: RequestInit = {
      method: "POST",
      headers: {
        ...anthropicAuthHeaders(this.auth),
        "anthropic-version": "2023-06-01",
        accept: "text/event-stream",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    };
    if (request.signal !== undefined) {
      init.signal = request.signal;
    }
    const response = await this.fetchImpl(`${this.baseUrl}/messages`, init);

    if (!response.ok) {
      throw new ModelAdapterError(
        "anthropic_http_error",
        `Anthropic request failed with HTTP ${response.status}: ${await response.text()}`,
      );
    }
    if (response.body === null) {
      throw new ModelAdapterError(
        "anthropic_response_invalid",
        "Anthropic response did not include a body",
      );
    }

    return parseAnthropicSseResponse(
      parseSseEvents<AnthropicStreamEvent>(response),
      toolNameMap.providerToCanonical,
      request.onAssistantDelta,
    );
  }
}

function buildAnthropicRequestBody(
  model: string,
  request: ModelRequest,
  canonicalToProvider: Map<string, string>,
  injectClaudeCodeIdentity: boolean,
  capabilities: ModelCapabilities,
): JsonObject {
  const system = [
    ...(injectClaudeCodeIdentity ? [CLAUDE_CODE_SYSTEM_IDENTITY] : []),
    request.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n\n"),
  ]
    .filter((part) => part.trim() !== "")
    .join("\n\n");
  const messages = request.messages
    .filter((message) => message.role !== "system")
    .map((message) => toAnthropicMessage(message, canonicalToProvider));

  const body: JsonObject = {
    model,
    max_tokens: maxTokensForReasoning(request.reasoningEffort),
    stream: true,
    messages,
  };
  if (system !== "") {
    body.system = system;
  }
  if (request.tools.length > 0) {
    body.tools = request.tools.map((tool) => toAnthropicTool(tool, canonicalToProvider));
    body.tool_choice = { type: "auto" };
  }
  const thinking = anthropicThinkingConfig(model, request.reasoningEffort, capabilities);
  if (thinking !== undefined) {
    body.thinking = thinking.thinking;
    if (thinking.outputConfig !== undefined) {
      body.output_config = thinking.outputConfig;
    }
  }
  return body;
}

function toAnthropicMessage(message: AgentMessage, toolNameMap: Map<string, string>): JsonObject {
  if (message.role === "tool") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: normalizeAnthropicToolCallId(message.toolCallId ?? ""),
          content: message.content,
        },
      ],
    };
  }

  if (message.role === "assistant") {
    const content: JsonObject[] = [];
    if (message.content.trim() !== "") {
      content.push({ type: "text", text: message.content });
    }
    for (const toolCall of message.toolCalls ?? []) {
      content.push({
        type: "tool_use",
        id: normalizeAnthropicToolCallId(toolCall.id),
        name: toolNameMap.get(toolCall.name) ?? toolCall.name,
        input: parseToolInput(toolCall.argumentsText),
      });
    }
    return {
      role: "assistant",
      content: content.length === 0 ? [{ type: "text", text: "" }] : content,
    };
  }

  return {
    role: "user",
    content: buildUserContentParts(message.content, message.attachments ?? []),
  };
}

function buildUserContentParts(
  text: string,
  attachments: readonly AgentAttachment[],
): JsonObject[] {
  const content: JsonObject[] = [];
  if (text !== "") {
    content.push({ type: "text", text });
  }
  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      content.push({
        type: "image",
        source: {
          type: "base64",
          media_type: attachment.mimeType,
          data: attachment.dataBase64,
        },
      });
    }
  }
  return content.length === 0 ? [{ type: "text", text: "" }] : content;
}

function toAnthropicTool(tool: ToolMetadata, toolNameMap: Map<string, string>): JsonObject {
  return {
    name: toolNameMap.get(tool.name) ?? tool.name,
    description: tool.description,
    input_schema: tool.inputSchema,
  };
}

function normalizeAnthropicToolCallId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
}

function parseToolInput(argumentsText: string): JsonValue {
  try {
    const parsed = JSON.parse(argumentsText) as JsonValue;
    return parsed;
  } catch {
    return {};
  }
}

async function parseAnthropicSseResponse(
  events: AsyncIterable<AnthropicStreamEvent>,
  providerToCanonical: Map<string, string>,
  onAssistantDelta?: (delta: string) => void,
): Promise<ModelResponse> {
  let content = "";
  let finishReason = "unknown";
  let providerResponseId: string | undefined;
  let usage: JsonObject | undefined;
  const toolBlocks = new Map<
    number,
    { id: string; name: string; inputText: string; order: number }
  >();
  let nextOrder = 0;

  for await (const event of events) {
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "message_start") {
      const message = event.message as { id?: unknown; usage?: unknown } | undefined;
      if (typeof message?.id === "string") {
        providerResponseId = message.id;
      }
      if (isJsonObject(message?.usage)) {
        usage = message.usage;
      }
    } else if (type === "content_block_start") {
      const index = typeof event.index === "number" ? event.index : nextOrder;
      const block = event.content_block as
        | { type?: unknown; id?: unknown; name?: unknown; input?: unknown }
        | undefined;
      if (
        block?.type === "tool_use" &&
        typeof block.id === "string" &&
        typeof block.name === "string"
      ) {
        toolBlocks.set(index, {
          id: block.id,
          name: providerToCanonical.get(block.name) ?? block.name,
          inputText: initialToolInputText(block.input),
          order: nextOrder,
        });
        nextOrder += 1;
      }
    } else if (type === "content_block_delta") {
      const index = typeof event.index === "number" ? event.index : 0;
      const delta = event.delta as
        | { type?: unknown; text?: unknown; partial_json?: unknown }
        | undefined;
      if (delta?.type === "text_delta" && typeof delta.text === "string") {
        content += delta.text;
        onAssistantDelta?.(delta.text);
      } else if (delta?.type === "input_json_delta" && typeof delta.partial_json === "string") {
        const block = toolBlocks.get(index);
        if (block !== undefined) {
          block.inputText += delta.partial_json;
        }
      }
    } else if (type === "message_delta") {
      const delta = event.delta as { stop_reason?: unknown } | undefined;
      if (typeof delta?.stop_reason === "string") {
        finishReason = delta.stop_reason;
      }
      const eventUsage = event.usage;
      if (isJsonObject(eventUsage)) {
        usage = usage === undefined ? eventUsage : { ...usage, ...eventUsage };
      }
    } else if (type === "message_stop") {
      if (finishReason === "unknown") {
        finishReason = "end_turn";
      }
    } else if (type === "error") {
      const error = event.error as { message?: unknown } | undefined;
      throw new ModelAdapterError(
        "anthropic_stream_error",
        typeof error?.message === "string" ? error.message : JSON.stringify(event),
      );
    }
  }

  const toolCalls: AgentToolCall[] = Array.from(toolBlocks.values())
    .sort((a, b) => a.order - b.order)
    .map((block) => ({
      id: block.id,
      name: block.name,
      argumentsText: normalizeJsonText(block.inputText),
    }));

  const response: ModelResponse = {
    content,
    toolCalls,
    finishReason: toolCalls.length > 0 && finishReason === "tool_use" ? "tool_calls" : finishReason,
  };
  if (providerResponseId !== undefined) {
    response.providerResponseId = providerResponseId;
  }
  if (usage !== undefined) {
    response.usage = usage;
  }
  return response;
}

function normalizeJsonText(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") {
    return "{}";
  }
  try {
    return JSON.stringify(JSON.parse(trimmed));
  } catch {
    return trimmed;
  }
}

function initialToolInputText(input: unknown): string {
  if (input === undefined) {
    return "";
  }
  if (isJsonObject(input) && Object.keys(input).length === 0) {
    return "";
  }
  return JSON.stringify(input);
}

function thinkingBudgetForLevel(level: ThinkingLevel | undefined): number | undefined {
  if (level === undefined || level === "off") {
    return undefined;
  }
  if (level === "minimal") return 1024;
  if (level === "low") return 2048;
  if (level === "medium") return 8192;
  return 16_384;
}

function anthropicThinkingConfig(
  model: string,
  level: ThinkingLevel | undefined,
  capabilities: ModelCapabilities,
): { thinking: JsonObject; outputConfig?: JsonObject } | undefined {
  if (level === undefined || !capabilities.reasoning) {
    return undefined;
  }

  if (level === "off") {
    return { thinking: { type: "disabled" } };
  }

  if (usesAdaptiveThinking(model)) {
    return {
      thinking: { type: "adaptive", display: ANTHROPIC_THINKING_DISPLAY },
      outputConfig: { effort: mapThinkingLevelToEffort(capabilities, level) },
    };
  }

  return {
    thinking: {
      type: "enabled",
      budget_tokens: thinkingBudgetForLevel(level) ?? 1024,
      display: ANTHROPIC_THINKING_DISPLAY,
    },
  };
}

function usesAdaptiveThinking(model: string): boolean {
  return /(?:opus[-.]4[-.][678]|sonnet[-.]4[-.]6)/i.test(model);
}

function mapThinkingLevelToEffort(
  capabilities: ModelCapabilities,
  level: ThinkingLevel,
): AnthropicEffort {
  const mapped = mapThinkingLevel(capabilities, level);
  if (typeof mapped === "string") return mapped as AnthropicEffort;

  if (level === "minimal" || level === "low") {
    return "low";
  }
  if (level === "medium") {
    return "medium";
  }
  return "high";
}

function maxTokensForReasoning(level: ThinkingLevel | undefined): number {
  const budget = thinkingBudgetForLevel(level);
  return budget === undefined ? DEFAULT_MAX_TOKENS : Math.max(DEFAULT_MAX_TOKENS, budget + 4096);
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
