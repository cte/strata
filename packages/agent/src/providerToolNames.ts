import type { ToolMetadata } from "@strata/tools";
import { ModelAdapterError } from "./model.js";

export interface ProviderToolNameMap {
  canonicalToProvider: Map<string, string>;
  providerToCanonical: Map<string, string>;
}

export function createProviderToolNameMap(tools: ToolMetadata[]): ProviderToolNameMap {
  const canonicalToProvider = new Map<string, string>();
  const providerToCanonical = new Map<string, string>();

  for (const tool of tools) {
    const providerName = encodeProviderToolName(tool.name);
    const collision = providerToCanonical.get(providerName);
    if (collision !== undefined && collision !== tool.name) {
      throw new ModelAdapterError(
        "tool_name_collision",
        `Tool names collide after provider encoding: ${collision}, ${tool.name}`,
      );
    }
    providerToCanonical.set(providerName, tool.name);
    canonicalToProvider.set(tool.name, providerName);
  }

  return { canonicalToProvider, providerToCanonical };
}

export function encodeProviderToolName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
}
