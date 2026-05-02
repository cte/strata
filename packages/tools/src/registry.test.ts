import { describe, expect, test } from "bun:test";
import { ToolRegistry, ToolRegistryError } from "./registry.js";

describe("ToolRegistry", () => {
  test("rejects unknown tools", async () => {
    const registry = new ToolRegistry();
    expect(() => registry.get("wiki.missing")).toThrow(ToolRegistryError);
    const result = await registry.safeExecute("wiki.missing", {}, { repoRoot: process.cwd() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("unknown_tool");
    }
  });

  test("executes registered tools", async () => {
    const registry = new ToolRegistry();
    registry.register({
      name: "wiki.echo",
      description: "Echo args.",
      mode: "read",
      inputSchema: { type: "object" },
      handler(args) {
        return { echoed: args };
      },
    });

    await expect(
      registry.execute("wiki.echo", { value: "ok" }, { repoRoot: process.cwd() }),
    ).resolves.toEqual({ echoed: { value: "ok" } });
  });
});
