import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createDefaultToolRegistry } from "./index.js";

describe("shell tools", () => {
  test("runs arbitrary shell commands in dangerous profile", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-shell-tools-"));
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

  test("returns non-zero exits without treating them as tool failures", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-shell-tools-"));
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
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-shell-tools-"));
    try {
      const registry = createDefaultToolRegistry({ profile: "dangerous" });
      await expect(
        registry.execute(
          "shell.run",
          {
            command: "printf abcdef && printf 123456 >&2",
            maxOutputChars: 3,
          },
          { repoRoot },
        ),
      ).resolves.toMatchObject({
        stdout: { text: "abc", chars: 6, truncated: true },
        stderr: { text: "123", chars: 6, truncated: true },
      });
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("marks timed-out commands", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-shell-tools-"));
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

  test("is unavailable outside dangerous profile", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "cortex-shell-tools-"));
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
