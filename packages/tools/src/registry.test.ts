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

  test("filters and blocks tools outside the active profile", async () => {
    const registry = new ToolRegistry({ profile: "read-only" });
    registry.register({
      name: "wiki.read",
      description: "Read.",
      mode: "read",
      inputSchema: { type: "object" },
      handler() {
        return { read: true };
      },
    });
    registry.register({
      name: "wiki.write",
      description: "Write.",
      mode: "write",
      inputSchema: { type: "object" },
      handler() {
        return { write: true };
      },
    });

    expect(registry.list().map((tool) => tool.name)).toEqual(["wiki.read"]);
    const result = await registry.safeExecute("wiki.write", {}, { repoRoot: process.cwd() });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("tool_unavailable");
    }
  });

  test("executes tool calls from JSON argument text", async () => {
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
      registry.safeExecuteText("wiki.echo", '{"value":"ok"}', { repoRoot: process.cwd() }),
    ).resolves.toMatchObject({
      ok: true,
      result: { echoed: { value: "ok" } },
    });
  });

  test("returns structured errors for invalid JSON argument text", async () => {
    const registry = new ToolRegistry();
    const result = await registry.safeExecuteText("wiki.echo", "[]", { repoRoot: process.cwd() });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("invalid_tool_args");
      expect(result.error.message).toBe("Tool arguments must be a JSON object");
    }
  });
});
