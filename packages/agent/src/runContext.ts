import {
  type AgentInstructionFile,
  type JsonObject,
  listPromptVisibleSkills,
  listTodos,
  loadAgentInstructionFiles,
  type MemoryDocument,
  readMemoryDocuments,
  type SkillMetadata,
  type TodoItem,
} from "@strata/core";
import type { AgentMessage } from "./types.js";

export interface BuildRunContextOptions {
  question: string;
  repoRoot: string;
  maxMemoryChars?: number;
  maxTodos?: number;
  maxSkills?: number;
}

export interface BuiltRunContext {
  messages: AgentMessage[];
  systemContext: JsonObject;
}

const DEFAULT_MAX_MEMORY_CHARS = 4_000;
const DEFAULT_MAX_TODOS = 20;
const DEFAULT_MAX_SKILLS = 40;

export async function buildRunContext(options: BuildRunContextOptions): Promise<BuiltRunContext> {
  const maxMemoryChars = options.maxMemoryChars ?? DEFAULT_MAX_MEMORY_CHARS;
  const maxTodos = options.maxTodos ?? DEFAULT_MAX_TODOS;
  const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS;
  const [agentInstructions, memory, todos, skills] = await Promise.all([
    loadAgentInstructionFiles(options.repoRoot),
    readMemoryDocuments(options.repoRoot, "all", maxMemoryChars),
    listTodos(options.repoRoot, false),
    listPromptVisibleSkills(options.repoRoot),
  ]);

  const activeTodos = todos.slice(0, maxTodos);
  const skillIndex = skills.slice(0, maxSkills);
  const systemContext: JsonObject = {
    agentInstructions: agentInstructions.map(agentInstructionToContext),
    memory: memory.map(memoryDocumentToContext),
    activeTodos: activeTodos.map(todoToContext),
    skills: skillIndex.map(skillToContext),
    truncated: {
      todos: todos.length > activeTodos.length,
      skills: skills.length > skillIndex.length,
    },
  };

  return {
    systemContext,
    messages: [
      { role: "system", content: createBaseSystemPrompt() },
      {
        role: "system",
        content: formatSystemContext(agentInstructions, memory, activeTodos, skillIndex),
      },
      { role: "user", content: options.question },
    ],
  };
}

function createBaseSystemPrompt(): string {
  return [
    "You are Strata, a local wiki and learning agent.",
    "Answer using the Strata wiki and cite wiki-relative Markdown paths when possible.",
    "Use wiki.retrieve for broad or complex evidence gathering, wiki.search for quick exact candidate lookup, and wiki.readPage to inspect specific pages.",
    "Prefer curated wiki pages over raw source snapshots; only pass includeRaw when curated pages are insufficient or raw evidence is specifically needed.",
    "Use fs.list, fs.find, fs.grep, and fs.read when broader repo inspection is needed.",
    "Use sessions.search or sessions.recent when the user refers to prior work or previous context.",
    "Use skills.list and skills.read when a stored procedure is relevant to the task.",
    "Use todo.list to understand active work. Use todo.add, todo.update, and todo.remove when available to maintain task state.",
    "Use memory.read when durable user or operations context matters. Use memory.write or memory.append only for stable facts that should affect future sessions.",
    "Do not store secrets in wiki pages, traces, memory, skills, or proposals.",
    "Do not invent wiki facts. If the wiki lacks enough evidence, say so.",
  ].join("\n");
}

function formatSystemContext(
  agentInstructions: AgentInstructionFile[],
  memory: MemoryDocument[],
  activeTodos: TodoItem[],
  skills: SkillMetadata[],
): string {
  return [
    "Strata durable context for this run.",
    ...formatAgentInstructionsSection(agentInstructions),
    "",
    "## Memory",
    formatMemory(memory),
    "",
    "## Active Todos",
    formatTodos(activeTodos),
    "",
    "## Skill Index",
    formatSkills(skills),
    "",
    "Call skills.read for full skill content when a listed skill applies.",
  ].join("\n");
}

function formatAgentInstructionsSection(agentInstructions: AgentInstructionFile[]): string[] {
  if (agentInstructions.length === 0) {
    return [];
  }
  return ["", "## Agent Instructions", formatAgentInstructions(agentInstructions)];
}

function formatAgentInstructions(agentInstructions: AgentInstructionFile[]): string {
  return agentInstructions
    .map((file) => {
      const suffix = file.truncated ? "\n\n[truncated]" : "";
      return `### ${file.path}\n${file.content.trim()}${suffix}`;
    })
    .join("\n\n");
}

function formatMemory(memory: MemoryDocument[]): string {
  if (memory.every((document) => document.content.trim() === "")) {
    return "No durable memory has been recorded yet.";
  }
  return memory
    .map((document) => {
      const content = document.content.trim();
      if (content === "") {
        return `### ${document.target}\nNo entries.`;
      }
      const suffix = document.truncated ? "\n\n[truncated]" : "";
      return `### ${document.target} (${document.path})\n${content}${suffix}`;
    })
    .join("\n\n");
}

function formatTodos(todos: TodoItem[]): string {
  if (todos.length === 0) {
    return "No active todos.";
  }
  return todos
    .map((todo) => {
      const tags = todo.tags.length === 0 ? "" : ` tags=${todo.tags.join(",")}`;
      const due = todo.due === null ? "" : ` due=${todo.due}`;
      const notes = todo.notes.trim() === "" ? "" : ` notes=${todo.notes.trim()}`;
      return `- ${todo.id} [${todo.status}/${todo.priority}] ${todo.title}${due}${tags}${notes}`;
    })
    .join("\n");
}

function formatSkills(skills: SkillMetadata[]): string {
  if (skills.length === 0) {
    return "No skills are installed.";
  }
  return skills
    .map((skill) => {
      const triggers = skill.triggers.length === 0 ? "" : ` triggers=${skill.triggers.join(" | ")}`;
      const description = skill.description === "" ? "No description." : skill.description;
      return `- ${skill.name} (${skill.status}): ${description}${triggers}`;
    })
    .join("\n");
}

function memoryDocumentToContext(document: MemoryDocument): JsonObject {
  return {
    target: document.target,
    path: document.path,
    exists: document.exists,
    chars: document.chars,
    truncated: document.truncated,
    content: document.content,
  };
}

function todoToContext(todo: TodoItem): JsonObject {
  return {
    id: todo.id,
    title: todo.title,
    status: todo.status,
    priority: todo.priority,
    notes: todo.notes,
    tags: todo.tags,
    due: todo.due,
    createdAt: todo.createdAt,
    updatedAt: todo.updatedAt,
  };
}

function skillToContext(skill: SkillMetadata): JsonObject {
  return {
    name: skill.name,
    directory: skill.directory,
    path: skill.path,
    description: skill.description,
    status: skill.status,
    triggers: skill.triggers,
    source: skill.source,
    disableModelInvocation: skill.disableModelInvocation,
  };
}

function agentInstructionToContext(file: AgentInstructionFile): JsonObject {
  return {
    path: file.path,
    chars: file.chars,
    truncated: file.truncated,
    content: file.content,
  };
}
