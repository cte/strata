import { randomUUID } from "node:crypto";

export interface TerminalSocketData {
  kind: "terminal";
  sessionId: string;
}

export interface TerminalSession {
  id: string;
  process: Bun.Subprocess<"pipe", "pipe", "pipe">;
  stdin: Bun.FileSink;
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

    const session: TerminalSession = { id, process, stdin };

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
    session.stdin.end();

    session.process.kill();
  }
}

export function createTerminalSocketData(): TerminalSocketData {
  return { kind: "terminal", sessionId: randomUUID() };
}
