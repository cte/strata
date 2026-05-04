import {
  addTodo,
  listTodos,
  removeTodo,
  updateTodo,
  type TodoAddInput,
  type TodoPriority,
  type TodoStatus,
  type TodoUpdateInput,
} from "@cortex/core";
import type { JsonObject, JsonValue } from "@cortex/core";
import {
  optionalBoolean,
  optionalEnum,
  optionalNullableString,
  optionalString,
  optionalStringArray,
  requiredEnum,
  requiredNonEmptyString,
} from "./args.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

interface TodoListArgs extends JsonObject {
  includeDone?: JsonValue;
}

interface TodoAddArgs extends JsonObject {
  title?: JsonValue;
  notes?: JsonValue;
  priority?: JsonValue;
  due?: JsonValue;
  tags?: JsonValue;
}

interface TodoUpdateArgs extends JsonObject {
  id?: JsonValue;
  title?: JsonValue;
  status?: JsonValue;
  notes?: JsonValue;
  priority?: JsonValue;
  due?: JsonValue;
  tags?: JsonValue;
}

interface TodoRemoveArgs extends JsonObject {
  id?: JsonValue;
}

const TODO_PRIORITIES = ["low", "normal", "high"] as const satisfies readonly TodoPriority[];
const TODO_STATUSES = [
  "open",
  "in_progress",
  "blocked",
  "done",
  "cancelled",
] as const satisfies readonly TodoStatus[];

export function registerTodoTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createTodoTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createTodoTools(): ToolDefinition[] {
  return [todoListTool, todoAddTool, todoUpdateTool, todoRemoveTool];
}

const todoListTool: ToolDefinition<TodoListArgs> = {
  name: "todo.list",
  description: "List Cortex runtime todos.",
  mode: "read",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      includeDone: { type: "boolean", description: "Include done and cancelled items." },
    },
  },
  maxResultChars: 64_000,
  async handler(args, context) {
    const includeDone = optionalBoolean(args.includeDone, false, "includeDone");
    const items = await listTodos(context.repoRoot, includeDone);
    return { items, count: items.length };
  },
};

const todoAddTool: ToolDefinition<TodoAddArgs> = {
  name: "todo.add",
  description: "Add a Cortex runtime todo.",
  mode: "learning",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["title"],
    properties: {
      title: { type: "string" },
      notes: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high"] },
      due: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const input: TodoAddInput = {
      title: requiredNonEmptyString(args.title, "title"),
      priority: optionalEnum(args.priority, "normal", TODO_PRIORITIES, "priority"),
      notes: optionalString(args.notes, "", "notes"),
      tags: optionalStringArray(args.tags, [], "tags"),
      due: optionalNullableString(args.due, null, "due"),
    };
    const item = await addTodo(context.repoRoot, input);
    return { item };
  },
};

const todoUpdateTool: ToolDefinition<TodoUpdateArgs> = {
  name: "todo.update",
  description: "Update a Cortex runtime todo.",
  mode: "learning",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string" },
      title: { type: "string" },
      status: { type: "string", enum: ["open", "in_progress", "blocked", "done", "cancelled"] },
      notes: { type: "string" },
      priority: { type: "string", enum: ["low", "normal", "high"] },
      due: { type: ["string", "null"] },
      tags: { type: "array", items: { type: "string" } },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const id = requiredNonEmptyString(args.id, "id");
    const input: TodoUpdateInput = {};
    if (args.title !== undefined) {
      input.title = requiredNonEmptyString(args.title, "title");
    }
    if (args.status !== undefined) {
      input.status = requiredEnum(args.status, TODO_STATUSES, "status");
    }
    if (args.notes !== undefined) {
      input.notes = optionalString(args.notes, "", "notes");
    }
    if (args.priority !== undefined) {
      input.priority = requiredEnum(args.priority, TODO_PRIORITIES, "priority");
    }
    if (args.due !== undefined) {
      input.due = optionalNullableString(args.due, null, "due");
    }
    if (args.tags !== undefined) {
      input.tags = optionalStringArray(args.tags, [], "tags");
    }
    const item = await updateTodo(context.repoRoot, id, input);
    return { item };
  },
};

const todoRemoveTool: ToolDefinition<TodoRemoveArgs> = {
  name: "todo.remove",
  description: "Remove a Cortex runtime todo.",
  mode: "learning",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["id"],
    properties: {
      id: { type: "string" },
    },
  },
  maxResultChars: 32_000,
  async handler(args, context) {
    const id = requiredNonEmptyString(args.id, "id");
    const removed = await removeTodo(context.repoRoot, id);
    return { removed };
  },
};
