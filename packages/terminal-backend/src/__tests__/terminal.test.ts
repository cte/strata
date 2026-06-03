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

  test("publishes resize frames", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const bridge = new TerminalHttpBridge(new TerminalSessionManager(repoRoot, testShellEnv()));
    const session = bridge.create({ cols: 80, rows: 24 });
    try {
      const response = bridge.stream(session.id, new AbortController().signal);
      expect(response).toBeDefined();
      const reader = response!.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

      expect(bridge.resize(session.id, { cols: 120, rows: 40 })).toBe(true);
      const text = await readUntil(reader, "resized");
      expect(text).toContain('"cols":120');
      expect(text).toContain('"rows":40');
    } finally {
      await bridge.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("sends heartbeat comments while the terminal is idle", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const bridge = new TerminalHttpBridge(new TerminalSessionManager(repoRoot, testShellEnv()), {
      heartbeatMs: 5,
    });
    const session = bridge.create({ cols: 80, rows: 24 });
    try {
      const response = bridge.stream(session.id, new AbortController().signal);
      expect(response).toBeDefined();
      const reader = response!.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

      const text = await readUntil(reader, ": keepalive");
      expect(text).toContain("event: ready");
      expect(text).toContain(": keepalive");
    } finally {
      await bridge.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("keeps the PTY alive across output stream reconnects", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const bridge = new TerminalHttpBridge(new TerminalSessionManager(repoRoot, testShellEnv()));
    const session = bridge.create({ cols: 80, rows: 24 });
    try {
      const first = bridge.stream(session.id, new AbortController().signal);
      expect(first).toBeDefined();
      const firstReader = first!.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      await readUntil(firstReader, "event: ready");

      const second = bridge.stream(session.id, new AbortController().signal);
      expect(second).toBeDefined();
      const secondReader = second!.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;
      bridge.write(session.id, "echo reconnected\nexit\n");
      const text = await readUntil(secondReader, "reconnected");
      expect(text).toContain("reconnected");
    } finally {
      await bridge.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("propagates resize to the child PTY", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const bridge = new TerminalHttpBridge(new TerminalSessionManager(repoRoot, testShellEnv()));
    const session = bridge.create({ cols: 80, rows: 24 });
    try {
      const response = bridge.stream(session.id, new AbortController().signal);
      expect(response).toBeDefined();
      const reader = response!.body!.getReader() as ReadableStreamDefaultReader<Uint8Array>;

      expect(bridge.resize(session.id, { cols: 111, rows: 33 })).toBe(true);
      bridge.write(session.id, "stty size\nexit\n");
      const text = await readUntil(reader, "33 111");
      expect(text).toContain("33 111");
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

  test("terminates shell process on close", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot, testShellEnv());
    const session = manager.create();
    try {
      await manager.close(session.id);
      const exited = await Promise.race([
        session.process.exited.then(() => true),
        new Promise<false>((resolve) => setTimeout(() => resolve(false), 1_000)),
      ]);
      expect(exited).toBe(true);
    } finally {
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

  test("runs the shell inside a PTY with initial dimensions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot, testShellEnv());
    const session = manager.create({ cols: 111, rows: 33 });
    try {
      session.write("test -t 0; echo TTY:$?; stty size; exit\n");
      const output = await readProcessOutput(session.process.stdout);
      expect(output).toContain("TTY:0");
      expect(output).toContain("33 111");
    } finally {
      await manager.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("tracks requested terminal dimensions", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-terminal-"));
    const manager = new TerminalSessionManager(repoRoot, testShellEnv());
    const session = manager.create({ cols: 100, rows: 30 });
    try {
      expect(session.cols).toBe(100);
      expect(session.rows).toBe(30);
      expect(manager.resize(session.id, 132, 43)).toBe(true);
      expect(session.cols).toBe(132);
      expect(session.rows).toBe(43);
    } finally {
      await manager.close(session.id);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("accepts browser CR input as shell commands", async () => {
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

async function readProcessOutput(stream: ReadableStream<Uint8Array>): Promise<string> {
  return await Promise.race([
    new Response(stream).text(),
    new Promise<string>((_resolve, reject) =>
      setTimeout(() => reject(new Error("Timed out waiting for PTY output.")), 5_000),
    ),
  ]);
}
