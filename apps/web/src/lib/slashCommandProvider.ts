import type { AutocompleteProvider, AutocompleteSuggestions } from "@/lib/useAutocomplete";

export type ChatSlashCommandName = "clear" | "compact" | "fork" | "help" | "model" | "skill";

export interface SlashCommandDefinition {
  name: ChatSlashCommandName;
  description: string;
}

export interface ParsedSlashCommand {
  name: ChatSlashCommandName;
  args: string;
}

export const CHAT_SLASH_COMMANDS: readonly SlashCommandDefinition[] = [
  { name: "clear", description: "clear the visible chat" },
  { name: "compact", description: "summarize the current session to free context" },
  { name: "fork", description: "branch from the current session" },
  { name: "help", description: "show chat commands" },
  { name: "model", description: "open model controls" },
  { name: "skill", description: "run a skill with /skill:<name>" },
];

const COMMANDS_BY_NAME = new Map(CHAT_SLASH_COMMANDS.map((command) => [command.name, command]));

export function createSlashCommandProvider(
  commands: readonly SlashCommandDefinition[] = CHAT_SLASH_COMMANDS,
): AutocompleteProvider {
  const sortedCommands = [...commands].sort((a, b) => a.name.localeCompare(b.name));
  return {
    id: "slash-commands",
    provide({ text, cursor }): AutocompleteSuggestions | undefined {
      const before = text.slice(0, cursor);
      if (!before.startsWith("/") || before.includes("\n")) {
        return undefined;
      }
      const prefix = before.slice(1).toLowerCase();
      if (/\s/.test(prefix)) {
        return undefined;
      }
      const items = sortedCommands
        .filter((command) => command.name.startsWith(prefix))
        .map((command) => ({
          label: `/${command.name}`,
          value: `/${command.name}`,
          description: command.description,
          kind: "command",
          commit: "run" as const,
        }));
      if (items.length === 0) {
        return undefined;
      }
      return { items, replaceStart: 0, replaceEnd: cursor };
    },
  };
}

export function parseSlashCommand(input: string): ParsedSlashCommand | undefined {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return undefined;
  }
  const space = trimmed.indexOf(" ");
  const rawName = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
  const args = space === -1 ? "" : trimmed.slice(space + 1).trim();
  if (rawName.startsWith("skill:")) {
    const skillName = rawName.slice("skill:".length);
    return skillName === ""
      ? undefined
      : { name: "skill", args: [skillName, args].join(" ").trim() };
  }
  if (!isChatSlashCommandName(rawName)) {
    return undefined;
  }
  return { name: rawName, args };
}

export function slashCommandDefinitions(): SlashCommandDefinition[] {
  return [...COMMANDS_BY_NAME.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function isChatSlashCommandName(value: string): value is ChatSlashCommandName {
  return COMMANDS_BY_NAME.has(value as ChatSlashCommandName);
}
