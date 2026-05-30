import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { RoutineStore } from "@strata/routines";
import { JobRegistry } from "../registry.js";
import { nextRunAt, RoutineTriggerStore } from "../routineTriggerStore.js";
import { runDueTriggersOnce } from "../scheduler.js";

async function makeRoutine(repoRoot: string): Promise<string> {
  const store = await RoutineStore.open({ repoRoot });
  try {
    const routine = store.createRoutine({
      name: "Echo routine",
      description: "test",
      prompt: "noop",
      inputSchema: { type: "object" },
    });
    return routine.id;
  } finally {
    store.close();
  }
}

function stubRoutineRunRegistry(): JobRegistry {
  const registry = new JobRegistry();
  registry.register({
    name: "routine.run",
    description: "Stub routine runner.",
    mode: "write",
    defaultConcurrency: "skip",
    inputSchema: { type: "object" },
    async run(input) {
      return {
        status: "ok",
        summary: `ran ${String(input.routineId)}`,
        metrics: { calls: 1 },
      };
    },
  });
  return registry;
}

describe("routine triggers", () => {
  test("computes interval and cron next run times", () => {
    const now = new Date("2026-05-27T10:00:30.000Z");
    expect(nextRunAt({ type: "interval", seconds: 120 }, now)).toBe("2026-05-27T10:02:30.000Z");
    expect(nextRunAt({ type: "cron", expression: "*/15 * * * *" }, now)).toBe(
      "2026-05-27T10:15:00.000Z",
    );
  });

  test("claims due triggers, fires routine.run, and records the last run", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-triggers-"));
    try {
      const routineId = await makeRoutine(repoRoot);
      const registry = stubRoutineRunRegistry();

      let triggerId = "";
      const store = await RoutineTriggerStore.open({ repoRoot });
      try {
        const trigger = store.create({
          routineId,
          name: "Echo",
          input: { foo: 1 },
          trigger: { type: "interval", seconds: 60 },
          now: new Date("2026-05-27T10:00:00.000Z"),
        });
        triggerId = trigger.id;
      } finally {
        store.close();
      }

      const result = await runDueTriggersOnce({
        repoRoot,
        registry,
        now: new Date("2026-05-27T10:01:00.000Z"),
      });
      expect(result.claimed).toBe(1);
      expect(result.results[0]).toMatchObject({
        triggerId,
        routineId,
        status: "completed",
        summary: `ran ${routineId}`,
      });

      const nextStore = await RoutineTriggerStore.open({ repoRoot });
      try {
        const [trigger] = nextStore.list();
        expect(trigger).toMatchObject({
          lastStatus: "completed",
          lastRunAt: "2026-05-27T10:01:00.000Z",
          nextRunAt: "2026-05-27T10:02:00.000Z",
        });

        const sessionId = trigger?.lastSessionId;
        expect(sessionId).toBeTruthy();
        const sessionStore = await SessionStore.open(repoRoot);
        try {
          const session = sessionStore.getSession(sessionId ?? "");
          expect(session?.kind).toBe("job");
          expect(session?.status).toBe("completed");
          const events = sessionStore.listEvents(sessionId ?? "");
          expect(events.find((event) => event.type === "job.started")?.payload).toMatchObject({
            schedule: {
              id: trigger?.id,
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

  test("cascade-deletes a routine's triggers when the routine is deleted", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-triggers-"));
    try {
      const routineId = await makeRoutine(repoRoot);
      const triggerStore = await RoutineTriggerStore.open({ repoRoot });
      try {
        triggerStore.create({
          routineId,
          trigger: { type: "interval", seconds: 60 },
        });
        expect(triggerStore.listByRoutine(routineId)).toHaveLength(1);
      } finally {
        triggerStore.close();
      }

      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.deleteRoutine(routineId);
      } finally {
        routineStore.close();
      }

      const verifyStore = await RoutineTriggerStore.open({ repoRoot });
      try {
        expect(verifyStore.listByRoutine(routineId)).toHaveLength(0);
      } finally {
        verifyStore.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});
