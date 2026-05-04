import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getCortexPaths } from "./paths.js";
import { CortexStateError } from "./stateErrors.js";
import type { JsonObject } from "./types.js";

export type TodoStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";
export type TodoPriority = "low" | "normal" | "high";

export interface TodoItem extends JsonObject {
  id: string;
  title: string;
  status: TodoStatus;
  priority: TodoPriority;
  notes: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  due: string | null;
}

export interface TodoState extends JsonObject {
  version: 1;
  items: TodoItem[];
}

export interface TodoAddInput {
  title: string;
  notes?: string;
  priority?: TodoPriority;
  due?: string | null;
  tags?: string[];
}

export interface TodoUpdateInput {
  title?: string;
  status?: TodoStatus;
  notes?: string;
  priority?: TodoPriority;
  due?: string | null;
  tags?: string[];
}

const TODO_FILE = "todos.json";

export async function readTodoState(repoRoot: string): Promise<TodoState> {
  const file = todoStatePath(repoRoot);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<TodoState>;
    if (parsed.version !== 1 || !Array.isArray(parsed.items)) {
      throw new CortexStateError("todo_state_invalid", `Invalid todo state file: ${file}`);
    }
    return { version: 1, items: parsed.items as TodoItem[] };
  } catch (error: unknown) {
    if (isNotFoundError(error)) {
      return { version: 1, items: [] };
    }
    throw error;
  }
}

export async function writeTodoState(repoRoot: string, state: TodoState): Promise<void> {
  const file = todoStatePath(repoRoot);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

export async function listTodos(repoRoot: string, includeDone = false): Promise<TodoItem[]> {
  const state = await readTodoState(repoRoot);
  if (includeDone) {
    return state.items;
  }
  return state.items.filter((item) => item.status !== "done" && item.status !== "cancelled");
}

export async function addTodo(repoRoot: string, input: TodoAddInput): Promise<TodoItem> {
  const now = new Date().toISOString();
  const item: TodoItem = {
    id: createTodoId(),
    title: input.title,
    status: "open",
    priority: input.priority ?? "normal",
    notes: input.notes ?? "",
    tags: input.tags ?? [],
    createdAt: now,
    updatedAt: now,
    due: input.due ?? null,
  };
  const state = await readTodoState(repoRoot);
  state.items.push(item);
  await writeTodoState(repoRoot, state);
  return item;
}

export async function updateTodo(
  repoRoot: string,
  id: string,
  input: TodoUpdateInput,
): Promise<TodoItem> {
  const state = await readTodoState(repoRoot);
  const item = state.items.find((candidate) => candidate.id === id);
  if (item === undefined) {
    throw new CortexStateError("todo_not_found", `Todo not found: ${id}`);
  }

  if (input.title !== undefined) {
    item.title = input.title;
  }
  if (input.status !== undefined) {
    item.status = input.status;
  }
  if (input.notes !== undefined) {
    item.notes = input.notes;
  }
  if (input.priority !== undefined) {
    item.priority = input.priority;
  }
  if (input.due !== undefined) {
    item.due = input.due;
  }
  if (input.tags !== undefined) {
    item.tags = input.tags;
  }
  item.updatedAt = new Date().toISOString();
  await writeTodoState(repoRoot, state);
  return item;
}

export async function removeTodo(repoRoot: string, id: string): Promise<TodoItem> {
  const state = await readTodoState(repoRoot);
  const index = state.items.findIndex((candidate) => candidate.id === id);
  if (index === -1) {
    throw new CortexStateError("todo_not_found", `Todo not found: ${id}`);
  }
  const [removed] = state.items.splice(index, 1);
  if (removed === undefined) {
    throw new CortexStateError("todo_not_found", `Todo not found: ${id}`);
  }
  await writeTodoState(repoRoot, state);
  return removed;
}

export function todoStatePath(repoRoot: string): string {
  return path.join(getCortexPaths(repoRoot).runtimeDir, TODO_FILE);
}

function createTodoId(): string {
  return `todo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code === "ENOENT"
  );
}
