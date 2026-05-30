import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { PTY_HOST_SOURCE } from "./ptyHostSource.js";

export interface TerminalSession {
  id: string;
  shell: string;
  cols: number;
  rows: number;
  process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stdin: Bun.FileSink;
  write(data: string | Uint8Array): void;
  resize(cols: number, rows: number): void;
}

export interface TerminalSize {
  cols: number;
  rows: number;
}

const DEFAULT_SIZE: TerminalSize = { cols: 80, rows: 24 };

export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined> = Bun.env,
  ) {}

  create(size: Partial<TerminalSize> = {}): TerminalSession {
    const id = randomUUID();
    const shell = this.env.SHELL && this.env.SHELL.trim().length > 0 ? this.env.SHELL : "/bin/sh";
    const initialSize = normalizeSize(size);

    const process = Bun.spawn([this.pythonBinary(), "-u", "-c", PTY_HOST_SOURCE], {
      cwd: this.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...this.env,
        STRATA_TERMINAL_SHELL: shell,
        STRATA_TERMINAL_COLS: String(initialSize.cols),
        STRATA_TERMINAL_ROWS: String(initialSize.rows),
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
        COLUMNS: String(initialSize.cols),
        LINES: String(initialSize.rows),
        STRATA_WEB_TERMINAL: "1",
        PS1: "strata$ ",
        PROMPT_COMMAND: "",
        ZDOTDIR: `${this.cwd}/.strata/terminal-empty-zdotdir`,
      },
    });
    const stdin = process.stdin;

    const session: TerminalSession = {
      id,
      shell,
      cols: initialSize.cols,
      rows: initialSize.rows,
      process,
      stdin,
      write(data) {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        writeControlFrame(stdin, {
          type: "input",
          dataBase64: Buffer.from(text, "utf8").toString("base64"),
        });
      },
      resize(cols, rows) {
        const next = normalizeSize({ cols, rows });
        session.cols = next.cols;
        session.rows = next.rows;
        writeControlFrame(stdin, { type: "resize", cols: next.cols, rows: next.rows });
      },
    };

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  resize(id: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(id);
    if (session === undefined) return false;
    session.resize(cols, rows);
    return true;
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    this.sessions.delete(id);
    try {
      writeControlFrame(session.stdin, { type: "close" });
    } catch {
      // The PTY host may have already exited and closed stdin.
    }
    try {
      session.stdin.end();
    } catch {
      // The PTY host may have already exited and closed stdin.
    }
    await terminateProcess(session.process);
  }

  private pythonBinary(): string {
    const configured = this.env.STRATA_TERMINAL_PYTHON;
    return configured && configured.trim().length > 0 ? configured : "python3";
  }
}

function normalizeSize(size: Partial<TerminalSize>): TerminalSize {
  return {
    cols: positiveInt(size.cols, DEFAULT_SIZE.cols),
    rows: positiveInt(size.rows, DEFAULT_SIZE.rows),
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
}

function writeControlFrame(stdin: Bun.FileSink, frame: Record<string, unknown>): void {
  stdin.write(`${JSON.stringify(frame)}\n`);
  stdin.flush();
}

async function terminateProcess(process: Bun.Subprocess<"pipe", "pipe", "pipe">): Promise<void> {
  const exited = process.exited.then(
    () => true,
    () => true,
  );
  process.kill("SIGTERM");
  const terminated = await Promise.race([exited, delay(250).then(() => false)]);
  if (terminated) return;
  process.kill("SIGKILL");
  await Promise.race([exited, delay(250)]);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
