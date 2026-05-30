import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultToolRegistry } from "../index.js";

describe("shell tools", () => {
  test("runs arbitrary shell commands in dangerous profile", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      const result = await registry.execute(
        "shell.run",
        { command: "printf hello && printf err >&2" },
        { repoRoot },
      );

      expect(result).toMatchObject({
        command: "printf hello && printf err >&2",
        cwd: repoRoot,
        exitCode: 0,
        timedOut: false,
        stdout: { text: "hello", truncated: false },
        stderr: { text: "err", truncated: false },
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("streams stdout and stderr chunks through onOutput as they arrive", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      const chunks: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
      const result = await registry.execute(
        "shell.run",
        { command: "printf hello && printf oops >&2" },
        { repoRoot, onOutput: (chunk) => chunks.push(chunk) },
      );

      const stdout = chunks
        .filter((c) => c.stream === "stdout")
        .map((c) => c.text)
        .join("");
      const stderr = chunks
        .filter((c) => c.stream === "stderr")
        .map((c) => c.text)
        .join("");
      expect(stdout).toBe("hello");
      expect(stderr).toBe("oops");
      expect(result).toMatchObject({
        stdout: { text: "hello" },
        stderr: { text: "oops" },
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("caps streamed output at maxOutputChars", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      let streamed = "";
      await registry.execute(
        "shell.run",
        { command: "printf 'aaaaaaaaaa'", maxOutputChars: 4 },
        { repoRoot, onOutput: (chunk) => (streamed += chunk.text) },
      );
      expect(streamed).toBe("aaaa");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("returns non-zero exits without treating them as tool failures", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      const result = await registry.safeExecute(
        "shell.run",
        { command: "printf nope >&2; exit 7" },
        { repoRoot },
      );

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result).toMatchObject({
          exitCode: 7,
          stderr: { text: "nope" },
        });
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("truncates stdout and stderr previews independently", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      const result = (await registry.execute(
        "shell.run",
        {
          command: "printf abcdef && printf 123456 >&2",
          maxOutputChars: 3,
        },
        { repoRoot },
      )) as any;

      expect(result).toMatchObject({
        stdout: { text: "def", chars: 6, truncated: true },
        stderr: { text: "456", chars: 6, truncated: true },
      });
      expect(await readFile(result.stdout.fullOutputPath, "utf8")).toBe("abcdef");
      expect(await readFile(result.stderr.fullOutputPath, "utf8")).toBe("123456");
      await rm(result.stdout.fullOutputPath, { force: true });
      await rm(result.stderr.fullOutputPath, { force: true });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("marks timed-out commands", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      await expect(
        registry.execute("shell.run", { command: "sleep 1", timeoutMs: 10 }, { repoRoot }),
      ).resolves.toMatchObject({
        timedOut: true,
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("cancels running commands through the tool context signal", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      const controller = new AbortController();
      const promise = registry.execute(
        "shell.run",
        { command: "printf started; sleep 30", timeoutMs: 10_000 },
        { repoRoot, signal: controller.signal },
      );

      await new Promise((resolve) => setTimeout(resolve, 25));
      controller.abort();
      const result = await withTimeout(promise, 2_000);

      expect(result).toMatchObject({
        timedOut: false,
        cancelled: true,
        stdout: { text: "started" },
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("resolves after the shell exits when a background child keeps stdio open", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    const pidFile = path.join(repoRoot, "child.pid");
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      const result = await withTimeout(
        registry.execute(
          "shell.run",
          {
            command: `sleep 30 & echo $! > ${shellQuote(pidFile)}; printf parent-done`,
            timeoutMs: 500,
          },
          { repoRoot },
        ),
        2_000,
      );

      expect(result).toMatchObject({
        exitCode: 0,
        timedOut: false,
        stdout: { text: "parent-done" },
      });
    } finally {
      await killPidFromFile(pidFile);
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("is unavailable outside dangerous profile", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "maintenance" });
      const result = await registry.safeExecute(
        "shell.run",
        { command: "printf hidden" },
        { repoRoot },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("tool_unavailable");
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: Timer | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`Timed out after ${timeoutMs}ms`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

async function killPidFromFile(pidFile: string): Promise<void> {
  try {
    const pid = Number.parseInt((await readFile(pidFile, "utf8")).trim(), 10);
    if (Number.isFinite(pid) && pid > 0) {
      process.kill(pid, "SIGKILL");
    }
  } catch {
    // The process may have already exited.
  }
}
