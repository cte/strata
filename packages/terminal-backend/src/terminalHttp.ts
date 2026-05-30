import { type TerminalSession, TerminalSessionManager, type TerminalSize } from "./terminal.js";

export interface TerminalHttpSessionInfo {
  id: string;
  shell: string;
  cols: number;
  rows: number;
}

interface TerminalHttpSession {
  id: string;
  shell: string;
  session: TerminalSession;
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  closed: boolean;
  cols: number;
  rows: number;
  exitCode?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class TerminalHttpBridge {
  private sessions = new Map<string, TerminalHttpSession>();

  constructor(private readonly manager: TerminalSessionManager) {}

  create(size: Partial<TerminalSize> = {}): TerminalHttpSessionInfo {
    const session = this.manager.create(size);
    const record: TerminalHttpSession = {
      id: session.id,
      shell: session.shell,
      session,
      subscribers: new Set(),
      closed: false,
      cols: session.cols,
      rows: session.rows,
    };
    this.sessions.set(session.id, record);
    void this.pump(record, session.process.stdout, "stdout");
    void this.pump(record, session.process.stderr, "stderr");
    void session.process.exited.then((exitCode) => {
      record.exitCode = exitCode;
      this.close(session.id, `process exited ${exitCode}`);
    });
    return { id: session.id, shell: session.shell, cols: session.cols, rows: session.rows };
  }

  write(id: string, data: string): boolean {
    const record = this.sessions.get(id);
    if (record === undefined || record.closed) return false;
    record.session.write(data);
    return true;
  }

  resize(id: string, size: TerminalSize): boolean {
    const record = this.sessions.get(id);
    if (record === undefined || record.closed) return false;
    if (!this.manager.resize(id, size.cols, size.rows)) return false;
    record.cols = record.session.cols;
    record.rows = record.session.rows;
    this.publish(record, "resized", { cols: record.cols, rows: record.rows });
    return true;
  }

  stream(id: string, signal: AbortSignal): Response | undefined {
    const record = this.sessions.get(id);
    if (record === undefined) return undefined;
    const stream = new ReadableStream<Uint8Array>({
      start: (controller) => {
        if (record.closed) {
          controller.enqueue(
            sse("closed", { reason: "already closed", exitCode: record.exitCode }),
          );
          controller.close();
          return;
        }
        record.subscribers.add(controller);
        controller.enqueue(
          sse("ready", {
            id: record.id,
            shell: record.shell,
            cols: record.cols,
            rows: record.rows,
          }),
        );
        const abort = () => {
          record.subscribers.delete(controller);
          try {
            controller.close();
          } catch {
            // Already closed by the stream lifecycle.
          }
        };
        signal.addEventListener("abort", abort, { once: true });
      },
      cancel: () => {
        for (const subscriber of record.subscribers) {
          record.subscribers.delete(subscriber);
          break;
        }
      },
    });
    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  }

  async close(id: string, reason = "closed"): Promise<boolean> {
    const record = this.sessions.get(id);
    if (record === undefined) return false;
    if (!record.closed) {
      record.closed = true;
      for (const subscriber of record.subscribers) {
        try {
          subscriber.enqueue(sse("closed", { reason, exitCode: record.exitCode }));
          subscriber.close();
        } catch {
          // Subscriber already went away.
        }
      }
      record.subscribers.clear();
    }
    this.sessions.delete(id);
    await this.manager.close(id);
    return true;
  }

  private async pump(
    record: TerminalHttpSession,
    stream: ReadableStream<Uint8Array>,
    channel: "stdout" | "stderr",
  ): Promise<void> {
    const reader = stream.getReader();
    try {
      while (!record.closed) {
        const next = await reader.read();
        if (next.done) return;
        this.publish(record, channel, decoder.decode(next.value));
      }
    } catch {
      // Process teardown and client disconnect races are normal for this prototype.
    } finally {
      reader.releaseLock();
    }
  }

  private publish(record: TerminalHttpSession, event: string, data: unknown): void {
    const frame = sse(event, data);
    for (const subscriber of record.subscribers) {
      try {
        subscriber.enqueue(frame);
      } catch {
        record.subscribers.delete(subscriber);
      }
    }
  }
}

function sse(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
