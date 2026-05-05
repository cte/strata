import type { AutocompleteProvider, AutocompleteSuggestions } from "./editor.js";

export interface SlashCommand {
  name: string;
  description: string;
  run(args: string): void | Promise<void>;
}

export class SlashCommandRegistry implements AutocompleteProvider {
  private readonly commands = new Map<string, SlashCommand>();

  register(command: SlashCommand): this {
    this.commands.set(command.name, command);
    return this;
  }

  has(name: string): boolean {
    return this.commands.has(name);
  }

  get(name: string): SlashCommand | undefined {
    return this.commands.get(name);
  }

  list(): SlashCommand[] {
    return [...this.commands.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  parse(input: string): { command: SlashCommand; args: string } | undefined {
    const trimmed = input.trim();
    if (!trimmed.startsWith("/")) {
      return undefined;
    }
    const space = trimmed.indexOf(" ");
    const name = space === -1 ? trimmed.slice(1) : trimmed.slice(1, space);
    const args = space === -1 ? "" : trimmed.slice(space + 1).trim();
    const command = this.commands.get(name);
    return command === undefined ? undefined : { command, args };
  }

  provide(text: string, _cursor: number): AutocompleteSuggestions | undefined {
    if (!text.startsWith("/")) {
      return undefined;
    }
    const prefix = text.slice(1).toLowerCase();
    const items = this.list()
      .filter((cmd) => cmd.name.toLowerCase().startsWith(prefix))
      .map((cmd) => ({
        label: `/${cmd.name}`,
        value: `/${cmd.name}`,
        description: cmd.description,
      }));
    if (items.length === 0) {
      return undefined;
    }
    return { items, replaceStart: 0, replaceEnd: text.length };
  }
}
