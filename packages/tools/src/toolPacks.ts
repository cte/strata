import type { JsonObject } from "@strata/core/types";
import { createDefaultToolRegistry, type DefaultToolRegistryOptions } from "./index.js";
import type { ToolRegistry } from "./registry.js";
import type { ToolProfile } from "./types.js";

export interface ToolPackContext {
  repoRoot: string;
  env: Record<string, string | undefined>;
  signal?: AbortSignal;
}

export interface ToolPack {
  name: string;
  register(registry: ToolRegistry, context: ToolPackContext): Promise<void>;
}

export interface ToolRegistryWithPacksOptions extends DefaultToolRegistryOptions {
  profile?: ToolProfile;
  packs?: ToolPack[];
  context: ToolPackContext;
}

export async function createToolRegistryWithPacks(
  options: ToolRegistryWithPacksOptions,
): Promise<ToolRegistry> {
  const registry = createDefaultToolRegistry(
    options.profile === undefined ? {} : { profile: options.profile },
  );

  for (const pack of options.packs ?? []) {
    await pack.register(registry, options.context);
  }
  return registry;
}

export function jsonObjectFromUnknown(value: unknown): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {};
  }
  return value as JsonObject;
}
