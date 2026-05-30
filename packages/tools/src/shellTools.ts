import { spawn as spawnChild } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { JsonObject, JsonValue } from "@strata/core";
import { PolicyViolationError } from "./policy.js";
import { ToolRegistry } from "./registry.js";
import type { ToolDefinition } from "./types.js";

interface ShellRunArgs extends JsonObject {
  command?: JsonValue;
  cwd?: JsonValue;
  shell?: JsonValue;
  timeoutMs?: JsonValue;
  maxOutputChars?: JsonValue;
}

interface OutputPreview extends JsonObject {
  text: string;
  bytes: number;
  chars: number;
  truncated: boolean;
  fullOutputPath?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const STDIO_CLOSE_GRACE_MS = 100;

export function registerShellTools(registry: ToolRegistry): ToolRegistry {
  for (const tool of createShellTools()) {
    registry.register(tool);
  }
  return registry;
}

export function createShellTools(): ToolDefinition[] {
  return [shellRunTool];
}

const shellRunTool: ToolDefinition<ShellRunArgs> = {
  name: "shell.run",
  description:
    "Run an arbitrary shell command. Dangerous mode only; no command allowlist or denylist is applied.",
  mode: "dangerous",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    required: ["command"],
    properties: {
      command: { type: "string", description: "Exact command string to run." },
      cwd: {
        type: "string",
        description:
          "Working directory. Relative paths resolve from the repo root; absolute paths are accepted.",
      },
      shell: {
        type: "string",
        description: "Shell executable. Defaults to $SHELL or /bin/sh.",
      },
      timeoutMs: {
        type: "integer",
        minimum: 1,
        description: `Kill the command after this many milliseconds. Defaults to ${DEFAULT_TIMEOUT_MS}.`,
      },
      maxOutputChars: {
        type: "integer",
        minimum: 1,
        description: `Maximum stdout/stderr characters returned. Defaults to ${DEFAULT_MAX_OUTPUT_CHARS}.`,
      },
    },
  },
  maxResultChars: 80_000,
  async handler(args, context) {
    const command = requiredNonEmptyString(args.command, "command");
    const cwd = resolveCwd(context.repoRoot, optionalString(args.cwd, ".", "cwd").trim() || ".");
    const shell = optionalString(args.shell, Bun.env.SHELL ?? "/bin/sh", "shell");
    const timeoutMs = optionalPositiveInteger(args.timeoutMs, DEFAULT_TIMEOUT_MS, "timeoutMs");
    const maxOutputChars = optionalPositiveInteger(
      args.maxOutputChars,
      DEFAULT_MAX_OUTPUT_CHARS,
      "maxOutputChars",
    );

    const startedAt = Date.now();
    if (context.signal?.aborted) {
      return {
        command,
        cwd,
        shell,
        exitCode: null,
        signalCode: null,
        timedOut: false,
        cancelled: true,
        durationMs: 0,
        stdout: emptyOutput(),
        stderr: emptyOutput(),
      };
    }

    let timedOut = false;
    let cancelled = false;
    const proc = Bun.spawn([shell, "-lc", command], {
      cwd,
      detached: process.platform !== "win32",
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: Bun.env,
    });

    const stdioCloseController = new AbortController();
    let stdioCloseTimer: Timer | undefined;
    const onAbort = () => {
      cancelled = true;
      killProcessTree(proc.pid);
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      killProcessTree(proc.pid);
    }, timeoutMs);

    try {
      if (context.signal !== undefined) {
        if (context.signal.aborted) {
          onAbort();
        } else {
          context.signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      // Stream stdout/stderr to the run as it arrives (capped at the same
      // budget as the returned preview) while still collecting the full text
      // for the final result.
      let stdoutEmitted = 0;
      let stderrEmitted = 0;
      const stdoutOutput = new OutputCollector(maxOutputChars, "strata-shell-stdout");
      const stderrOutput = new OutputCollector(maxOutputChars, "strata-shell-stderr");
      const emit = (stream: "stdout" | "stderr", text: string): void => {
        if (context.onOutput === undefined) {
          return;
        }
        const emitted = stream === "stdout" ? stdoutEmitted : stderrEmitted;
        const remaining = maxOutputChars - emitted;
        if (remaining <= 0) {
          return;
        }
        const slice = text.length > remaining ? text.slice(0, remaining) : text;
        if (stream === "stdout") {
          stdoutEmitted += slice.length;
        } else {
          stderrEmitted += slice.length;
        }
        context.onOutput({ stream, text: slice });
      };
      const stdoutTextPromise = readStreamText(
        proc.stdout,
        stdoutOutput,
        (text) => emit("stdout", text),
        stdioCloseController.signal,
      );
      const stderrTextPromise = readStreamText(
        proc.stderr,
        stderrOutput,
        (text) => emit("stderr", text),
        stdioCloseController.signal,
      );
      const exitCode = await proc.exited;
      clearTimeout(timeout);
      stdioCloseTimer = setTimeout(() => {
        stdioCloseController.abort();
      }, STDIO_CLOSE_GRACE_MS);
      await Promise.all([stdoutTextPromise, stderrTextPromise]);
      const [stdout, stderr] = await Promise.all([
        stdoutOutput.snapshot(),
        stderrOutput.snapshot(),
      ]);
      return {
        command,
        cwd,
        shell,
        exitCode,
        signalCode: proc.signalCode ?? null,
        timedOut,
        cancelled,
        durationMs: Date.now() - startedAt,
        stdout,
        stderr,
      };
    } finally {
      clearTimeout(timeout);
      if (context.signal !== undefined) {
        context.signal.removeEventListener("abort", onAbort);
      }
      if (stdioCloseTimer !== undefined) {
        clearTimeout(stdioCloseTimer);
      }
    }
  },
};

async function readStreamText(
  stream: ReadableStream<Uint8Array>,
  output: OutputCollector,
  onChunk?: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let removeAbortListener: (() => void) | undefined;
  const abortPromise =
    signal === undefined
      ? undefined
      : new Promise<"aborted">((resolve) => {
          const onAbort = (): void => {
            void reader.cancel().catch(() => {});
            resolve("aborted");
          };
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => signal.removeEventListener("abort", onAbort);
        });

  try {
    while (true) {
      const readPromise = reader.read().catch((error: unknown) => {
        if (signal?.aborted) {
          return "aborted" as const;
        }
        throw error;
      });
      const readResult =
        abortPromise === undefined
          ? await readPromise
          : await Promise.race([readPromise, abortPromise]);
      if (readResult === "aborted") {
        break;
      }
      const { done, value } = readResult;
      if (done) {
        break;
      }
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) {
        output.append(text);
        onChunk?.(text);
      }
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      output.append(tail);
      onChunk?.(tail);
    }
  } catch (error) {
    if (signal?.aborted) {
      return;
    }
    throw error;
  } finally {
    removeAbortListener?.();
    try {
      reader.releaseLock();
    } catch {
      // The stream may already be closed or cancelled.
    }
  }
}

class OutputCollector {
  private chunks: string[] = [];
  private previewChars = 0;
  private totalChars = 0;
  private totalBytes = 0;
  private fullOutputPath: string | undefined;
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly maxChars: number,
    private readonly tempFilePrefix: string,
  ) {}

  append(text: string): void {
    if (text.length === 0) {
      return;
    }

    this.totalChars += text.length;
    this.totalBytes += Buffer.byteLength(text, "utf8");

    if (this.totalChars > this.maxChars) {
      if (this.fullOutputPath === undefined) {
        this.fullOutputPath = path.join(tmpdir(), `${this.tempFilePrefix}-${randomUUID()}.log`);
        const outputPath = this.fullOutputPath;
        const initialContent = this.chunks.join("") + text;
        this.writeChain = this.writeChain.then(() => writeFile(outputPath, initialContent, "utf8"));
      } else {
        const outputPath = this.fullOutputPath;
        this.writeChain = this.writeChain.then(() => appendFile(outputPath, text, "utf8"));
      }
    }

    this.chunks.push(text);
    this.previewChars += text.length;
    this.trimPreview();
  }

  async snapshot(): Promise<OutputPreview> {
    await this.writeChain;
    const preview: OutputPreview = {
      text: this.chunks.join(""),
      bytes: this.totalBytes,
      chars: this.totalChars,
      truncated: this.totalChars > this.maxChars,
    };
    if (this.fullOutputPath !== undefined) {
      preview.fullOutputPath = this.fullOutputPath;
    }
    return preview;
  }

  private trimPreview(): void {
    let excess = this.previewChars - this.maxChars;
    while (excess > 0 && this.chunks.length > 0) {
      const first = this.chunks[0];
      if (first === undefined) {
        break;
      }
      if (first.length <= excess) {
        this.chunks.shift();
        this.previewChars -= first.length;
        excess -= first.length;
      } else {
        this.chunks[0] = first.slice(excess);
        this.previewChars -= excess;
        excess = 0;
      }
    }
  }
}

function emptyOutput(): OutputPreview {
  return {
    text: "",
    bytes: 0,
    chars: 0,
    truncated: false,
  };
}

function killProcessTree(pid: number): void {
  if (process.platform === "win32") {
    try {
      spawnChild("taskkill", ["/F", "/T", "/PID", String(pid)], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });
    } catch {
      // Ignore failures for processes that have already exited.
    }
    return;
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process already exited.
    }
  }
}

function resolveCwd(repoRoot: string, cwd: string): string {
  if (path.isAbsolute(cwd)) {
    return path.resolve(cwd);
  }
  return path.resolve(repoRoot, cwd);
}

function requiredNonEmptyString(value: JsonValue | undefined, name: string): string {
  const stringValue = requiredString(value, name).trim();
  if (stringValue === "") {
    throw new PolicyViolationError("invalid_args", `${name} cannot be empty`);
  }
  return stringValue;
}

function optionalString(value: JsonValue | undefined, fallback: string, name: string): string {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "string") {
    throw new PolicyViolationError("invalid_args", `${name} must be a string`);
  }
  return value;
}

function requiredString(value: JsonValue | undefined, name: string): string {
  if (typeof value !== "string") {
    throw new PolicyViolationError("invalid_args", `${name} must be a string`);
  }
  return value;
}

function optionalPositiveInteger(
  value: JsonValue | undefined,
  fallback: number,
  name: string,
): number {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    throw new PolicyViolationError("invalid_args", `${name} must be a positive integer`);
  }
  return value;
}
