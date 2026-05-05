import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  addTodo,
  appendMemoryEntry,
  getCortexPaths,
  type JsonObject,
  type JsonValue,
  type LearningProposalKind,
  type LearningProposalRecord,
  listSkills,
  listTodos,
  type MemoryTarget,
  readMemoryDocument,
  readMemoryDocuments,
  readSessionTrace,
  SessionStore,
  type SkillMetadata,
  type TodoPriority,
  writeLearningProposal,
} from "@cortex/core";
import type { AgentMessage, ModelAdapter, ModelResponse } from "./types.js";

export interface ReflectionRunConfig {
  sessionId: string;
  model: ModelAdapter;
  repoRoot?: string;
  maxTraceChars?: number;
  maxMemoryEntryChars?: number;
  maxTodoTitleChars?: number;
  signal?: AbortSignal;
}

export interface ReflectionRunResult extends JsonObject {
  sessionId: string;
  model: string;
  tracePath: string;
  traceTruncated: boolean;
  reportPath: string;
  applied: JsonObject[];
  skipped: JsonObject[];
  proposals: LearningProposalRecord[];
  noops: string[];
}

interface ReflectionPlan extends JsonObject {
  memory_updates: MemoryReflectionUpdate[];
  todo_updates: TodoReflectionUpdate[];
  skill_updates: ProposalReflectionUpdate[];
  schema_updates: ProposalReflectionUpdate[];
  wiki_followups: ProposalReflectionUpdate[];
  lint_findings: ProposalReflectionUpdate[];
  noops: string[];
}

interface MemoryReflectionUpdate extends JsonObject {
  target: MemoryTarget;
  entry: string;
  reason: string;
  evidence: string[];
  risk: ReflectionRisk;
}

interface TodoReflectionUpdate extends JsonObject {
  action: "add";
  title: string;
  notes: string;
  priority: TodoPriority;
  due: string | null;
  tags: string[];
  reason: string;
  evidence: string[];
  risk: ReflectionRisk;
}

interface ProposalReflectionUpdate extends JsonObject {
  title: string;
  reason: string;
  evidence: string[];
  proposed_change: string;
  risk: ReflectionRisk;
}

type ReflectionRisk = "low" | "medium" | "high";

const DEFAULT_MAX_TRACE_CHARS = 80_000;
const DEFAULT_MAX_MEMORY_ENTRY_CHARS = 500;
const DEFAULT_MAX_TODO_TITLE_CHARS = 160;
const MAX_MEMORY_DOCUMENT_CHARS = 12_000;

export class ReflectionError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReflectionError";
    this.code = code;
  }
}

export async function runReflection(config: ReflectionRunConfig): Promise<ReflectionRunResult> {
  const repoRoot = getCortexPaths(config.repoRoot).repoRoot;
  const store = await SessionStore.open(repoRoot);
  try {
    const session = store.getSession(config.sessionId);
    if (session === undefined) {
      throw new ReflectionError("session_not_found", `Session not found: ${config.sessionId}`);
    }
    if (session.status === "running") {
      throw new ReflectionError(
        "session_running",
        `Cannot reflect on a running session: ${config.sessionId}`,
      );
    }

    const trace = await readSessionTrace(
      repoRoot,
      config.sessionId,
      config.maxTraceChars ?? DEFAULT_MAX_TRACE_CHARS,
    );
    await store.appendEvent(config.sessionId, "reflection.started", {
      model: config.model.name,
    });
    const [memory, todos, skills] = await Promise.all([
      readMemoryDocuments(repoRoot, "all", 4_000),
      listTodos(repoRoot, true),
      listSkills(repoRoot),
    ]);
    const promptContext: ReflectionPromptContext = {
      sessionId: config.sessionId,
      traceText: trace.text,
      traceTruncated: trace.truncated,
      memory: JSON.stringify(memory, null, 2),
      todos: JSON.stringify(todos, null, 2),
      skills: JSON.stringify(skills.map(skillSummary), null, 2),
    };
    if (config.signal !== undefined) {
      promptContext.signal = config.signal;
    }
    const response = await requestReflectionPlan(config.model, promptContext);
    const plan = parseReflectionPlan(response.content);
    const applied: JsonObject[] = [];
    const skipped: JsonObject[] = [];
    const proposals: LearningProposalRecord[] = [];

    await applyMemoryUpdates(repoRoot, plan.memory_updates, {
      applied,
      skipped,
      proposals,
      sessionId: config.sessionId,
      maxEntryChars: config.maxMemoryEntryChars ?? DEFAULT_MAX_MEMORY_ENTRY_CHARS,
    });
    await applyTodoUpdates(repoRoot, plan.todo_updates, {
      applied,
      skipped,
      maxTitleChars: config.maxTodoTitleChars ?? DEFAULT_MAX_TODO_TITLE_CHARS,
    });
    await stageProposalUpdates(repoRoot, config.sessionId, "skill", plan.skill_updates, proposals);
    await stageProposalUpdates(
      repoRoot,
      config.sessionId,
      "schema",
      plan.schema_updates,
      proposals,
    );
    await stageProposalUpdates(repoRoot, config.sessionId, "wiki", plan.wiki_followups, proposals);
    await stageProposalUpdates(repoRoot, config.sessionId, "wiki", plan.lint_findings, proposals);

    for (const proposal of proposals) {
      await store.appendEvent(config.sessionId, "proposal.created", proposal);
    }

    const reportPath = await writeReflectionReport(repoRoot, config.sessionId, {
      sessionId: config.sessionId,
      model: config.model.name,
      tracePath: trace.path,
      traceTruncated: trace.truncated,
      plan,
      applied,
      skipped,
      proposals,
      noops: plan.noops,
    });
    const result: ReflectionRunResult = {
      sessionId: config.sessionId,
      model: config.model.name,
      tracePath: trace.path,
      traceTruncated: trace.truncated,
      reportPath,
      applied,
      skipped,
      proposals,
      noops: plan.noops,
    };
    await store.appendEvent(config.sessionId, "reflection.completed", {
      reportPath,
      applied,
      skipped,
      proposals,
      noops: plan.noops,
    });
    return result;
  } catch (error: unknown) {
    if (store.getSession(config.sessionId) !== undefined) {
      await store.appendEvent(config.sessionId, "reflection.failed", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw error;
  } finally {
    store.close();
  }
}

interface ReflectionPromptContext {
  sessionId: string;
  traceText: string;
  traceTruncated: boolean;
  memory: string;
  todos: string;
  skills: string;
  signal?: AbortSignal;
}

async function requestReflectionPlan(
  model: ModelAdapter,
  context: ReflectionPromptContext,
): Promise<ModelResponse> {
  const messages: AgentMessage[] = [
    {
      role: "system",
      content: [
        "You are Cortex's post-run reflection classifier.",
        "Convert a completed session trace into durable learning updates.",
        "Return only one JSON object. Do not include Markdown fences or explanatory text.",
        "Do not propose storing secrets. Do not store one-off task progress as memory.",
        "Memory updates must be short declarative facts.",
        "Todo updates are only for concrete follow-up work.",
        "Skill/schema/wiki/lint changes must be staged as proposals.",
      ].join("\n"),
    },
    {
      role: "user",
      content: buildReflectionPrompt(context),
    },
  ];
  const request: {
    messages: AgentMessage[];
    tools: [];
    signal?: AbortSignal;
  } = { messages, tools: [] };
  if (context.signal !== undefined) {
    request.signal = context.signal;
  }
  return model.complete(request);
}

function buildReflectionPrompt(context: ReflectionPromptContext): string {
  return [
    `Reflect on session ${context.sessionId}.`,
    context.traceTruncated ? "The trace was truncated to the most recent events." : "",
    "",
    "Decision rules:",
    "- User preferences, identity, communication style -> memory_updates target user.",
    "- Environment facts, repo conventions, tool quirks -> memory_updates target operations.",
    "- Reusable procedure, pitfall, debugging path, or source-specific rule -> skill_updates.",
    "- Durable wiki convention or entity schema change -> schema_updates.",
    "- Work facts, project state, decisions, commitments -> wiki_followups.",
    "- One-off task progress -> noops.",
    "",
    "Return this JSON shape:",
    JSON.stringify(reflectionSchemaExample(), null, 2),
    "",
    "Current memory:",
    context.memory,
    "",
    "Current todos:",
    context.todos,
    "",
    "Skill index:",
    context.skills,
    "",
    "Session trace JSONL:",
    context.traceText,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function reflectionSchemaExample(): JsonObject {
  return {
    memory_updates: [
      {
        target: "user",
        entry: "The user prefers concise engineering status updates.",
        reason: "The user explicitly corrected response style.",
        evidence: ["message.user: ..."],
        risk: "low",
      },
    ],
    todo_updates: [
      {
        action: "add",
        title: "Follow up on the unresolved item",
        notes: "Why this remains open.",
        priority: "normal",
        due: null,
        tags: ["reflection"],
        reason: "The session ended with unresolved work.",
        evidence: ["agent.completed: ..."],
        risk: "low",
      },
    ],
    skill_updates: [],
    schema_updates: [],
    wiki_followups: [],
    lint_findings: [],
    noops: ["No durable learning was needed."],
  };
}

interface ApplyMemoryContext {
  sessionId: string;
  maxEntryChars: number;
  applied: JsonObject[];
  skipped: JsonObject[];
  proposals: LearningProposalRecord[];
}

async function applyMemoryUpdates(
  repoRoot: string,
  updates: MemoryReflectionUpdate[],
  context: ApplyMemoryContext,
): Promise<void> {
  for (const update of updates) {
    if (!isLowRisk(update.risk) || update.entry.length > context.maxEntryChars) {
      context.proposals.push(
        await writeLearningProposal(repoRoot, {
          kind: "memory",
          sessionId: context.sessionId,
          title: `Memory update: ${update.entry.slice(0, 60)}`,
          reason: update.reason,
          evidence: update.evidence,
          proposedChange: `Append to ${update.target} memory:\n\n${update.entry}`,
          risk: update.risk,
        }),
      );
      continue;
    }

    const document = await readMemoryDocument(repoRoot, update.target, Number.POSITIVE_INFINITY);
    if (document.content.includes(update.entry)) {
      context.skipped.push({
        kind: "memory",
        target: update.target,
        entry: update.entry,
        reason: "duplicate",
      });
      continue;
    }

    await appendMemoryEntry(
      repoRoot,
      update.target,
      update.entry,
      "Reflections",
      MAX_MEMORY_DOCUMENT_CHARS,
    );
    context.applied.push({
      kind: "memory",
      target: update.target,
      entry: update.entry,
      reason: update.reason,
    });
  }
}

interface ApplyTodoContext {
  maxTitleChars: number;
  applied: JsonObject[];
  skipped: JsonObject[];
}

async function applyTodoUpdates(
  repoRoot: string,
  updates: TodoReflectionUpdate[],
  context: ApplyTodoContext,
): Promise<void> {
  for (const update of updates) {
    if (!isLowRisk(update.risk) || update.title.length > context.maxTitleChars) {
      context.skipped.push({
        kind: "todo",
        title: update.title,
        reason: "not_low_risk",
      });
      continue;
    }

    const todos = await listTodos(repoRoot, true);
    if (todos.some((todo) => todo.title.toLowerCase() === update.title.toLowerCase())) {
      context.skipped.push({
        kind: "todo",
        title: update.title,
        reason: "duplicate",
      });
      continue;
    }

    const item = await addTodo(repoRoot, {
      title: update.title,
      notes: update.notes,
      priority: update.priority,
      due: update.due,
      tags: update.tags,
    });
    context.applied.push({
      kind: "todo",
      id: item.id,
      title: item.title,
      reason: update.reason,
    });
  }
}

async function stageProposalUpdates(
  repoRoot: string,
  sessionId: string,
  kind: LearningProposalKind,
  updates: ProposalReflectionUpdate[],
  proposals: LearningProposalRecord[],
): Promise<void> {
  for (const update of updates) {
    proposals.push(
      await writeLearningProposal(repoRoot, {
        kind,
        sessionId,
        title: update.title,
        reason: update.reason,
        evidence: update.evidence,
        proposedChange: update.proposed_change,
        risk: update.risk,
      }),
    );
  }
}

async function writeReflectionReport(
  repoRoot: string,
  sessionId: string,
  content: JsonObject,
): Promise<string> {
  const paths = getCortexPaths(repoRoot);
  const file = path.join(paths.reflectionsDir, `${sessionId}.json`);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(content, null, 2)}\n`, "utf8");
  return path.relative(repoRoot, file);
}

function parseReflectionPlan(content: string): ReflectionPlan {
  const parsed = JSON.parse(extractJsonObject(content)) as JsonObject;
  return {
    memory_updates: readArray(parsed.memory_updates).map(parseMemoryUpdate),
    todo_updates: readArray(parsed.todo_updates).map(parseTodoUpdate),
    skill_updates: readArray(parsed.skill_updates).map(parseProposalUpdate),
    schema_updates: readArray(parsed.schema_updates).map(parseProposalUpdate),
    wiki_followups: readArray(parsed.wiki_followups).map(parseProposalUpdate),
    lint_findings: readArray(parsed.lint_findings).map(parseProposalUpdate),
    noops: readStringArray(parsed.noops),
  };
}

function parseMemoryUpdate(value: JsonValue): MemoryReflectionUpdate {
  const object = requireObject(value, "memory update");
  const target = readMemoryTarget(object.target);
  return {
    target,
    entry: readNonEmptyString(object.entry, "memory entry"),
    reason: readString(object.reason, ""),
    evidence: readStringArray(object.evidence),
    risk: readRisk(object.risk),
  };
}

function parseTodoUpdate(value: JsonValue): TodoReflectionUpdate {
  const object = requireObject(value, "todo update");
  const action = readString(object.action, "add");
  if (action !== "add") {
    throw new ReflectionError("invalid_reflection_json", "Only todo action 'add' is supported");
  }
  return {
    action,
    title: readNonEmptyString(object.title, "todo title"),
    notes: readString(object.notes, ""),
    priority: readPriority(object.priority),
    due: readNullableString(object.due),
    tags: readStringArray(object.tags),
    reason: readString(object.reason, ""),
    evidence: readStringArray(object.evidence),
    risk: readRisk(object.risk),
  };
}

function parseProposalUpdate(value: JsonValue): ProposalReflectionUpdate {
  const object = requireObject(value, "proposal update");
  return {
    title: readNonEmptyString(object.title, "proposal title"),
    reason: readString(object.reason, ""),
    evidence: readStringArray(object.evidence),
    proposed_change: readNonEmptyString(object.proposed_change, "proposed_change"),
    risk: readRisk(object.risk),
  };
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
    throw new ReflectionError(
      "invalid_reflection_json",
      "Reflection response did not contain JSON",
    );
  }
  return trimmed.slice(first, last + 1);
}

function readArray(value: JsonValue | undefined): JsonValue[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new ReflectionError("invalid_reflection_json", "Expected an array in reflection JSON");
  }
  return value;
}

function requireObject(value: JsonValue, name: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ReflectionError("invalid_reflection_json", `${name} must be an object`);
  }
  return value;
}

function readString(value: JsonValue | undefined, fallback: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new ReflectionError("invalid_reflection_json", "Expected a string in reflection JSON");
  }
  return value;
}

function readNonEmptyString(value: JsonValue | undefined, name: string): string {
  const stringValue = readString(value, "").trim();
  if (stringValue === "") {
    throw new ReflectionError("invalid_reflection_json", `${name} cannot be empty`);
  }
  return stringValue;
}

function readNullableString(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new ReflectionError("invalid_reflection_json", "Expected a string or null");
  }
  return value;
}

function readStringArray(value: JsonValue | undefined): string[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ReflectionError("invalid_reflection_json", "Expected an array of strings");
  }
  return value as string[];
}

function readRisk(value: JsonValue | undefined): ReflectionRisk {
  if (value === undefined) {
    return "medium";
  }
  if (value !== "low" && value !== "medium" && value !== "high") {
    throw new ReflectionError("invalid_reflection_json", "Risk must be low, medium, or high");
  }
  return value;
}

function readMemoryTarget(value: JsonValue | undefined): MemoryTarget {
  if (value !== "user" && value !== "operations") {
    throw new ReflectionError(
      "invalid_reflection_json",
      "Memory target must be user or operations",
    );
  }
  return value;
}

function readPriority(value: JsonValue | undefined): TodoPriority {
  if (value === undefined) {
    return "normal";
  }
  if (value !== "low" && value !== "normal" && value !== "high") {
    throw new ReflectionError(
      "invalid_reflection_json",
      "Todo priority must be low, normal, or high",
    );
  }
  return value;
}

function isLowRisk(risk: ReflectionRisk): boolean {
  return risk === "low";
}

function skillSummary(skill: SkillMetadata): JsonObject {
  return {
    name: skill.name,
    description: skill.description,
    status: skill.status,
    triggers: skill.triggers,
  };
}
