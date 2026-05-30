import { randomUUID } from "node:crypto";

export interface TerminalSession {
  id: string;
  shell: string;
  process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stdin: Bun.FileSink;
  write(data: string | Uint8Array): void;
}

export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly cwd: string,
    private readonly env: Record<string, string | undefined> = Bun.env,
  ) {}

  create(): TerminalSession {
    const id = randomUUID();
    const shell = this.env.SHELL && this.env.SHELL.trim().length > 0 ? this.env.SHELL : "/bin/sh";

    const process = Bun.spawn([shell, "-i"], {
      cwd: this.cwd,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...this.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
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
      process,
      stdin,
      write(data) {
        const text = typeof data === "string" ? data : new TextDecoder().decode(data);
        stdin.write(text.replaceAll("\r", "\n"));
        stdin.flush();
      },
    };

    this.sessions.set(id, session);
    return session;
  }

  get(id: string): TerminalSession | undefined {
    return this.sessions.get(id);
  }

  async close(id: string): Promise<void> {
    const session = this.sessions.get(id);
    if (session === undefined) return;
    this.sessions.delete(id);
    try {
      session.stdin.end();
    } catch {
      // The shell may have already exited and closed stdin.
    }
    session.process.kill();
  }
}
