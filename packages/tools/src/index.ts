export * from "./fsTools.js";
export * from "./memoryTools.js";
export * from "./policy.js";
export * from "./registry.js";
export * from "./sessionTools.js";
export * from "./shellTools.js";
export * from "./skillTools.js";
export * from "./todoTools.js";
export * from "./types.js";
export * from "./wikiTools.js";

import { registerFileSystemTools } from "./fsTools.js";
import { registerMemoryTools } from "./memoryTools.js";
import { ToolRegistry } from "./registry.js";
import { registerSessionTools } from "./sessionTools.js";
import { registerShellTools } from "./shellTools.js";
import { registerSkillTools } from "./skillTools.js";
import { registerTodoTools } from "./todoTools.js";
import type { ToolProfile } from "./types.js";
import { registerWikiTools } from "./wikiTools.js";

export interface DefaultToolRegistryOptions {
  profile?: ToolProfile;
}

export function createDefaultToolRegistry(options: DefaultToolRegistryOptions = {}): ToolRegistry {
  const registry = new ToolRegistry({ profile: options.profile ?? "dangerous" });
  registerFileSystemTools(registry);
  registerMemoryTools(registry);
  registerShellTools(registry);
  registerSessionTools(registry);
  registerSkillTools(registry);
  registerTodoTools(registry);
  registerWikiTools(registry);
  return registry;
}
