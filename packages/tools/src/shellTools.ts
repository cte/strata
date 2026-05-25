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
}

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_OUTPUT_CHARS = 20_000;
const KILL_GRACE_MS = 1_000;

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
    let timedOut = false;
    let forceKillTimer: Timer | undefined;
    const proc = Bun.spawn([shell, "-lc", command], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: Bun.env,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      forceKillTimer = setTimeout(() => {
        proc.kill("SIGKILL");
      }, KILL_GRACE_MS);
    }, timeoutMs);

    try {
      // Stream stdout/stderr to the run as it arrives (capped at the same
      // budget as the returned preview) while still collecting the full text
      // for the final result.
      let stdoutEmitted = 0;
      let stderrEmitted = 0;
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
      const [stdoutText, stderrText, exitCode] = await Promise.all([
        readStreamText(proc.stdout, (text) => emit("stdout", text)),
        readStreamText(proc.stderr, (text) => emit("stderr", text)),
        proc.exited,
      ]);
      return {
        command,
        cwd,
        shell,
        exitCode,
        signalCode: proc.signalCode ?? null,
        timedOut,
        durationMs: Date.now() - startedAt,
        stdout: previewOutput(stdoutText, maxOutputChars),
        stderr: previewOutput(stderrText, maxOutputChars),
      };
    } finally {
      clearTimeout(timeout);
      if (forceKillTimer !== undefined) {
        clearTimeout(forceKillTimer);
      }
    }
  },
};

async function readStreamText(
  stream: ReadableStream<Uint8Array>,
  onChunk?: (text: string) => void,
): Promise<string> {
  if (onChunk === undefined) {
    return await new Response(stream).text();
  }
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      const text = decoder.decode(value, { stream: true });
      if (text.length > 0) {
        full += text;
        onChunk(text);
      }
    }
    const tail = decoder.decode();
    if (tail.length > 0) {
      full += tail;
      onChunk(tail);
    }
  } finally {
    reader.releaseLock();
  }
  return full;
}

function previewOutput(text: string, maxChars: number): OutputPreview {
  const truncated = text.length > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    bytes: Buffer.byteLength(text, "utf8"),
    chars: text.length,
    truncated,
  };
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
