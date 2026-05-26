import type { SessionStore } from "@strata/core/session-store";
import { QueueChangeStore } from "./queueChangeStore.js";

/** A "these sessions/runs changed" notice fanned out to live clients. */
export interface SessionChangeNotice {
  sessionIds: string[];
  maxEventId: number;
  queue?: {
    sessionIds: string[];
    runIds: string[];
    maxQueueChangeId: number;
  };
}

const DEFAULT_POLL_INTERVAL_MS = 750;

interface Subscriber {
  queue: SessionChangeNotice[];
  wake: (() => void) | null;
  closed: boolean;
}

/**
 * Local realtime hub. Tails the shared `events` table (written by every
 * process — web, CLI, TUI, maintenance, ingest) and fans out "session changed"
 * notices to subscribed browser clients over SSE. This is how a session being
 * advanced anywhere shows up live in every open tab without moving data off the
 * box: the data already lives in one local SQLite file; this just notifies.
 */
export class SessionChangeFeed {
  private readonly subscribers = new Set<Subscriber>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastEventId = 0;
  private lastQueueChangeId = 0;
  private baseline = false;
  private polling = false;
  private readonly queueChanges: QueueChangeStore;

  constructor(
    private readonly getStore: () => Promise<SessionStore>,
    private readonly pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS,
    repoRoot?: string,
  ) {
    this.queueChanges = new QueueChangeStore(repoRoot);
  }

  subscribe(): AsyncIterable<SessionChangeNotice> {
    const subscriber: Subscriber = { queue: [], wake: null, closed: false };
    this.subscribers.add(subscriber);
    this.ensurePolling();
    const subscribers = this.subscribers;
    return {
      async *[Symbol.asyncIterator]() {
        try {
          while (true) {
            while (subscriber.queue.length > 0) {
              yield subscriber.queue.shift() as SessionChangeNotice;
            }
            if (subscriber.closed) {
              return;
            }
            await new Promise<void>((resolve) => {
              subscriber.wake = resolve;
            });
          }
        } finally {
          subscribers.delete(subscriber);
        }
      },
    };
  }

  /** Stop polling and release subscribers (e.g. on server shutdown). */
  close(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.queueChanges.close();
    for (const subscriber of this.subscribers) {
      subscriber.closed = true;
      this.wake(subscriber);
    }
  }

  private ensurePolling(): void {
    if (this.timer !== null) {
      return;
    }
    this.timer = setInterval(() => {
      void this.poll();
    }, this.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    if (this.polling) {
      return;
    }
    this.polling = true;
    try {
      const store = await this.getStore();
      // First tick establishes the high-water mark so we don't replay history
      // as "changes" to freshly-connected clients.
      if (!this.baseline) {
        this.lastEventId = store.latestEventId();
        this.lastQueueChangeId = this.queueChanges.latestQueueChangeId();
        this.baseline = true;
        return;
      }
      if (this.subscribers.size === 0) {
        return;
      }
      const { maxEventId, sessionIds } = store.sessionChangesSince(this.lastEventId);
      const queue = this.queueChanges.queueChangesSince(this.lastQueueChangeId);
      const queueChanged = queue.sessionIds.length > 0 || queue.runIds.length > 0;
      if (sessionIds.length === 0 && !queueChanged) {
        return;
      }
      this.lastEventId = maxEventId;
      this.lastQueueChangeId = queue.maxQueueChangeId;
      const notice: SessionChangeNotice = {
        sessionIds,
        maxEventId,
        ...(queueChanged
          ? {
              queue: {
                sessionIds: queue.sessionIds,
                runIds: queue.runIds,
                maxQueueChangeId: queue.maxQueueChangeId,
              },
            }
          : {}),
      };
      for (const subscriber of this.subscribers) {
        subscriber.queue.push(notice);
        this.wake(subscriber);
      }
    } catch {
      // Transient DB/read error; the next tick retries.
    } finally {
      this.polling = false;
    }
  }

  private wake(subscriber: Subscriber): void {
    const wake = subscriber.wake;
    if (wake !== null) {
      subscriber.wake = null;
      wake();
    }
  }
}
