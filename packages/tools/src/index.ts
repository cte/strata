export * from "./policy.js";
export * from "./registry.js";
export * from "./types.js";
export * from "./wikiTools.js";

import { ToolRegistry } from "./registry.js";
import { registerWikiTools } from "./wikiTools.js";

export function createDefaultToolRegistry(): ToolRegistry {
  return registerWikiTools(new ToolRegistry());
}
