import type { JsonObject } from "@strata/core";
import { type DefaultJobDefinitionsOptions, defaultJobDefinitions } from "./definitions.js";
import type { JobDefinition, JobMetadata } from "./types.js";

export class JobRegistry {
  private readonly definitions = new Map<string, JobDefinition>();

  register<TInput extends JsonObject>(definition: JobDefinition<TInput>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Duplicate job definition: ${definition.name}`);
    }
    this.definitions.set(definition.name, definition as JobDefinition);
  }

  get(name: string): JobDefinition | undefined {
    return this.definitions.get(name);
  }

  list(): JobMetadata[] {
    return [...this.definitions.values()]
      .map((definition) => ({
        name: definition.name,
        description: definition.description,
        mode: definition.mode,
        defaultConcurrency: definition.defaultConcurrency,
        inputSchema: definition.inputSchema,
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
}

export function createDefaultJobRegistry(options: DefaultJobDefinitionsOptions = {}): JobRegistry {
  const registry = new JobRegistry();
  for (const definition of defaultJobDefinitions(options)) {
    registry.register(definition);
  }
  return registry;
}
