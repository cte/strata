import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerminalSessionManager } from "../terminal.js";

describe("TerminalSessionManager", () => {
  test("starts a shell process that accepts commands", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot);
    const session = manager.create();
    try {
      session.stdin.write(new TextEncoder().encode("pwd\nexit\n"));
      const output = await new Response(session.process.stdout).text();
      expect(output).toContain(repoRoot);
    } finally {
      await manager.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
