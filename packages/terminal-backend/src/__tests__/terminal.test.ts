import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TerminalSessionManager } from "../terminal.js";
import { TerminalHttpBridge } from "../terminalHttp.js";

describe("TerminalHttpBridge", () => {
  test("streams shell output over SSE-friendly frames", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const bridge = new TerminalHttpBridge(new TerminalSessionManager(repoRoot, testShellEnv()));
    const session = bridge.create();
    try {
      const response = bridge.stream(session.id, new AbortController().signal);
      expect(response).toBeDefined();
      const reader = response!.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

      bridge.write(session.id, "pwd\nexit\n");
      const text = await readUntil(reader, repoRoot);
      expect(text).toContain(repoRoot);
    } finally {
      await bridge.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

describe("TerminalSessionManager", () => {
  test("keeps an interactive shell alive until commands are sent", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot, testShellEnv());
    const session = manager.create();
    try {
      const earlyExit = await Promise.race([
        session.process.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 50)),
      ]);
      expect(earlyExit).toBe(false);
    } finally {
      await manager.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("starts a shell process that accepts LF-terminated commands", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot, testShellEnv());
    const session = manager.create();
    try {
      session.write("pwd\nexit\n");
      session.stdin.end();
      const output = await new Response(session.process.stdout).text();
      expect(output).toContain(repoRoot);
    } finally {
      await manager.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("normalizes browser CR input to shell LF commands", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot, testShellEnv());
    const session = manager.create();
    try {
      session.write("pwd\rexit\r");
      session.stdin.end();
      const output = await new Response(session.process.stdout).text();
      expect(output).toContain(repoRoot);
    } finally {
      await manager.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  needle: string,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + 5_000;
  while (!text.includes(needle) && Date.now() < deadline) {
    const next = await reader.read();
    if (next.done) break;
    text += decoder.decode(next.value);
  }
  await reader.cancel().catch(() => undefined);
  return text;
}

function testShellEnv(): Record<string, string | undefined> {
  return { ...Bun.env, SHELL: "/bin/sh" };
}
