import { type TerminalSession, TerminalSessionManager } from "./terminal.js";

export interface TerminalHttpSessionInfo {
  id: string;
  shell: string;
}

interface TerminalHttpSession {
  id: string;
  shell: string;
  session: TerminalSession;
  subscribers: Set<ReadableStreamDefaultController<Uint8Array>>;
  closed: boolean;
  exitCode?: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class TerminalHttpBridge {
  private sessions = new Map<string, TerminalHttpSession>();

  constructor(private readonly manager: TerminalSessionManager) {}

  create(): TerminalHttpSessionInfo {
    const session = this.manager.create();
    const record: TerminalHttpSession = {
      id: session.id,
      shell: session.shell,
      session,
      subscribers: new Set(),
      closed: false,
    };
    this.sessions.set(session.id, record);
    void this.pump(record, session.process.stdout, "stdout");
    void this.pump(record, session.process.stderr, "stderr");
    void session.process.exited.then((exitCode) => {
      record.exitCode = exitCode;
      this.close(session.id, `process exited ${exitCode}`);
    });
    return { id: session.id, shell: session.shell };
  }

  write(id: string, data: string): boolean {
    const record = this.sessions.get(id);
    if (record === undefined || record.closed) return false;
    record.session.write(data);
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
        controller.enqueue(sse("ready", { id: record.id, shell: record.shell }));
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
