export * from "./fsTools.js";
export * from "./policy.js";
export * from "./registry.js";
export * from "./types.js";
export * from "./wikiTools.js";

import { ToolRegistry } from "./registry.js";
import type { ToolProfile } from "./types.js";
import { registerFileSystemTools } from "./fsTools.js";
import { registerWikiTools } from "./wikiTools.js";

export interface DefaultToolRegistryOptions {
  profile?: ToolProfile;
}

export function createDefaultToolRegistry(options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry({ profile: options.profile ?? "read-only" });
  registerFileSystemTools(registry);
  registerWikiTools(registry);
  return registry;
}
