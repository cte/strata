import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { JobRegistry } from "./registry.js";
import { runDueSchedulesOnce } from "./scheduler.js";
import { nextRunAt, ScheduleStore } from "./scheduleStore.js";

describe("job schedules", () => {
  test("computes interval and cron next run times", () => {
    const now = new Date("2026-05-27T10:00:30.000Z");
    expect(nextRunAt({ type: "interval", seconds: 120 }, now)).toBe("2026-05-27T10:02:30.000Z");
    expect(nextRunAt({ type: "cron", expression: "*/15 * * * *" }, now)).toBe(
      "2026-05-27T10:15:00.000Z",
    );
  });

  test("claims due schedules, runs registered jobs, and records the last run", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-jobs-"));
    try {
      const registry = new JobRegistry();
      registry.register({
        name: "test.echo",
        description: "Echo a test schedule.",
        mode: "read",
        defaultConcurrency: "skip",
        inputSchema: { type: "object" },
        async run(input) {
          return {
            status: "ok",
            summary: `echo ${String(input.message ?? "")}`,
            metrics: { calls: 1 },
          };
        },
      });

      const store = await ScheduleStore.open({ repoRoot });
      try {
        store.create({
          name: "Echo",
          jobName: "test.echo",
          input: { message: "hello" },
          trigger: { type: "interval", seconds: 60 },
          now: new Date("2026-05-27T10:00:00.000Z"),
        });
      } finally {
        store.close();
      }

      const result = await runDueSchedulesOnce({
        repoRoot,
        registry,
        now: new Date("2026-05-27T10:01:00.000Z"),
      });
      expect(result.claimed).toBe(1);
      expect(result.results[0]).toMatchObject({
        jobName: "test.echo",
        status: "completed",
        summary: "echo hello",
      });

      const nextStore = await ScheduleStore.open({ repoRoot });
      try {
        const [schedule] = nextStore.list();
        expect(schedule).toMatchObject({
          lastStatus: "completed",
          lastRunAt: "2026-05-27T10:01:00.000Z",
          nextRunAt: "2026-05-27T10:02:00.000Z",
        });

        const sessionId = schedule?.lastSessionId;
        expect(sessionId).toBeTruthy();
        const sessionStore = await SessionStore.open(repoRoot);
        try {
          const session = sessionStore.getSession(sessionId ?? "");
          expect(session?.kind).toBe("job");
          expect(session?.status).toBe("completed");
          const events = sessionStore.listEvents(sessionId ?? "");
          expect(events.find((event) => event.type === "job.started")?.payload).toMatchObject({
            schedule: {
              id: schedule?.id,
              name: "Echo",
            },
          });
        } finally {
          sessionStore.close();
        }
      } finally {
        nextStore.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
