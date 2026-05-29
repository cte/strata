import type { JsonObject, JsonValue } from "@strata/core";
import type { EvidenceSpan, ExtractionCandidate, TodoVerification, TodoVerifier } from "./types.js";

export const MODEL_TODO_VERIFIER_PROMPT_VERSION = "daily.todo.llm-verifier-prompt-v1";

export interface TodoVerifierModelMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface TodoVerifierModelRequest {
  messages: TodoVerifierModelMessage[];
  tools: [];
  signal?: AbortSignal;
}

export interface TodoVerifierModelResponse {
  content: string;
}

export interface TodoVerifierModel {
  readonly name: string;
  complete(request: TodoVerifierModelRequest): Promise<TodoVerifierModelResponse>;
}

export interface CreateModelDailyTodoVerifierOptions {
  model: TodoVerifierModel;
  signal?: AbortSignal;
}

export class TodoVerificationResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TodoVerificationResponseError";
  }
}

export function createModelDailyTodoVerifier(
  options: CreateModelDailyTodoVerifierOptions,
): TodoVerifier {
  return {
    version: MODEL_TODO_VERIFIER_PROMPT_VERSION,
    modelName: options.model.name,
    async verify(candidate, span) {
      try {
        const request = buildTodoVerifierModelRequest(candidate, span, options.signal);
        const response = await options.model.complete(request);
        return parseTodoVerificationResponse(response.content);
      } catch (error) {
        return needsReviewFallback(candidate, verifierErrorRationale(error));
      }
    },
  };
}

export function buildTodoVerifierModelRequest(
  candidate: ExtractionCandidate,
  span: EvidenceSpan,
  signal?: AbortSignal,
): TodoVerifierModelRequest {
  const messages: TodoVerifierModelMessage[] = [
    {
      role: "system",
      content: [
        "You are Strata's daily TODO verifier.",
        "Classify one extracted candidate using only the provided evidence.",
        "Return exactly one JSON object. Do not include Markdown fences or explanatory text.",
        "Valid classification values: action, not_action, needs_review.",
        "Valid owner values: mine, theirs, unknown.",
        "Use confidence as a number from 0 to 1.",
        "Negative examples:",
        "- Agent or bot progress updates are not TODOs.",
        "- 'I checked', 'I found', 'Scanned the last 24 hours', and 'No code change needed' are outcomes, not commitments.",
        "- 'We should', 'might need', and similar possibility language are not TODOs unless assigned to a person or explicitly framed as an action item.",
        "- Search-count output such as 'search: 999' is tool/status output, not an action.",
        "- Quoted or generated task output should not create a TODO unless a human explicitly asks Strata to track or do it.",
      ].join("\n"),
    },
    {
      role: "user",
      content: buildTodoVerifierPrompt(candidate, span),
    },
  ];
  const request: TodoVerifierModelRequest = { messages, tools: [] };
  if (signal !== undefined) {
    request.signal = signal;
  }
  return request;
}

export function buildTodoVerifierPrompt(
  candidate: ExtractionCandidate,
  span: EvidenceSpan,
): string {
  return [
    "Classify this candidate as JSON with this exact shape:",
    JSON.stringify(todoVerificationSchemaExample(), null, 2),
    "",
    "Candidate:",
    JSON.stringify(candidatePacket(candidate), null, 2),
    "",
    "Evidence:",
    JSON.stringify(evidencePacket(span), null, 2),
  ].join("\n");
}

export function parseTodoVerificationResponse(content: string): TodoVerification {
  const parsed = JSON.parse(extractJsonObject(content)) as JsonValue;
  const object = requireObject(parsed, "todo verification");
  const classification = readClassification(object.classification);
  const confidence = readConfidence(object.confidence);
  const owner = readOwner(object.owner);
  const actionText = readNonEmptyString(object.actionText, "actionText");
  const rationale = readNonEmptyString(object.rationale, "rationale");
  const dueDate = readOptionalString(object.dueDate, "dueDate");
  const verification: TodoVerification = {
    classification,
    confidence,
    owner,
    actionText,
    rationale,
  };
  if (dueDate !== undefined) {
    verification.dueDate = dueDate;
  }
  return verification;
}

function todoVerificationSchemaExample(): JsonObject {
  return {
    classification: "action",
    confidence: 0.82,
    owner: "unknown",
    actionText: "Prepare the launch checklist.",
    dueDate: null,
    rationale: "A human directly requested a concrete task.",
  };
}

function candidatePacket(candidate: ExtractionCandidate): JsonObject {
  return {
    id: candidate.id,
    extractionName: candidate.extractionName,
    candidateKind: candidate.candidateKind,
    evidenceSpanId: candidate.evidenceSpanId,
    candidateText: candidate.candidateText,
    candidateHash: candidate.candidateHash,
    deterministicReasons: candidate.deterministicReasons,
    metadata: candidate.metadata,
  };
}

function evidencePacket(span: EvidenceSpan): JsonObject {
  const packet: JsonObject = {
    id: span.id,
    sourcePath: span.sourcePath,
    sourceKind: span.sourceKind,
    sourceType: span.sourceType,
    date: span.date,
    lineStart: span.lineStart,
    lineEnd: span.lineEnd,
    text: truncate(span.text, 2000),
    metadata: span.metadata,
  };
  if (span.contextText !== undefined) {
    packet.contextText = truncate(span.contextText, 2000);
  }
  return packet;
}

function needsReviewFallback(candidate: ExtractionCandidate, rationale: string): TodoVerification {
  return {
    classification: "needs_review",
    confidence: 0,
    owner: "unknown",
    actionText: candidate.candidateText,
    rationale,
  };
}

function verifierErrorRationale(error: unknown): string {
  if (error instanceof TodoVerificationResponseError || error instanceof SyntaxError) {
    return `model_verifier_invalid_json: ${error.message}`;
  }
  if (error instanceof Error) {
    return `model_verifier_error: ${error.message}`;
  }
  return `model_verifier_error: ${String(error)}`;
}

function extractJsonObject(content: string): string {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    return fenced[1];
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    throw new TodoVerificationResponseError("Verifier response did not contain a JSON object");
  }
  return trimmed.slice(first, last + 1);
}

function requireObject(value: JsonValue, label: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TodoVerificationResponseError(`Expected ${label} to be an object`);
  }
  return value;
}

function readClassification(value: JsonValue | undefined): TodoVerification["classification"] {
  if (value === "action" || value === "not_action" || value === "needs_review") {
    return value;
  }
  throw new TodoVerificationResponseError(
    "classification must be action, not_action, or needs_review",
  );
}

function readOwner(value: JsonValue | undefined): TodoVerification["owner"] {
  if (value === "mine" || value === "theirs" || value === "unknown") {
    return value;
  }
  throw new TodoVerificationResponseError("owner must be mine, theirs, or unknown");
}

function readConfidence(value: JsonValue | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new TodoVerificationResponseError("confidence must be a number from 0 to 1");
  }
  return value;
}

function readNonEmptyString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TodoVerificationResponseError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

function readOptionalString(value: JsonValue | undefined, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new TodoVerificationResponseError(`${label} must be a string or null`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) {
    return value;
  }
  return `${value.slice(0, maxChars)}\n[truncated]`;
}
