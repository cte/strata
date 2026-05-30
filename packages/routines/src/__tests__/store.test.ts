import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SessionStore } from "@strata/core";
import { RoutineNotRunnableError, RoutineStore } from "../store.js";
import type { CreateRoutineInput } from "../types.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("routine store", () => {
  test("creates, lists, reads, and updates routine definitions", async () => {
    const repoRoot = await tempRepo();
    const store = await RoutineStore.open({ repoRoot });
    try {
      const routine = store.createRoutine({
        ...routineInput(),
        now: new Date("2026-05-29T12:00:00.000Z"),
      });

      expect(routine).toMatchObject({
        id: "routine_test",
        name: "Test routine",
        status: "enabled",
        outputMode: "required",
        toolProfile: "maintenance",
        version: 1,
      });
      expect(store.getRoutine("routine_test")).toEqual(routine);
      expect(store.listRoutines()).toEqual([routine]);

      const updated = store.updateRoutine({
        id: "routine_test",
        status: "disabled",
        prompt: "Updated prompt",
        requiredSkills: ["routine-test"],
        now: new Date("2026-05-29T12:05:00.000Z"),
      });

      expect(updated.status).toBe("disabled");
      expect(updated.prompt).toBe("Updated prompt");
      expect(updated.requiredSkills).toEqual(["routine-test"]);
      expect(updated.version).toBe(2);
      expect(updated.createdAt).toBe(routine.createdAt);
      expect(updated.updatedAt).toBe("2026-05-29T12:05:00.000Z");
      expect(store.listRoutines({ status: "enabled" })).toEqual([]);
      expect(store.listRoutines({ status: "disabled" })).toEqual([updated]);
    } finally {
      store.close();
    }
  });

  test("rejects invalid routine definitions", async () => {
    const repoRoot = await tempRepo();
    const store = await RoutineStore.open({ repoRoot });
    try {
      expect(() =>
        store.createRoutine({
          ...routineInput(),
          id: "routine_missing_output_schema",
          outputSchema: null,
          outputMode: "required",
        }),
      ).toThrow(/requires outputSchema/);

      expect(() =>
        store.createRoutine({
          ...routineInput(),
          id: "routine_bad_profile",
          toolProfile: "writer" as "maintenance",
        }),
      ).toThrow(/toolProfile/);

      expect(() =>
        store.createRoutine({
          ...routineInput(),
          id: "routine_bad_pre_run_step",
          preRunSteps: [{ jobName: "", input: {} }],
        }),
      ).toThrow(/jobName/);
    } finally {
      store.close();
    }
  });

  test("does not return disabled or archived routines as runnable by default", async () => {
    const repoRoot = await tempRepo();
    const store = await RoutineStore.open({ repoRoot });
    try {
      store.createRoutine({
        ...routineInput(),
        id: "routine_disabled",
        status: "disabled",
      });
      store.createRoutine({
        ...routineInput(),
        id: "routine_archived",
        status: "archived",
      });

      expect(() => store.getRunnableRoutine("routine_disabled")).toThrow(RoutineNotRunnableError);
      expect(() => store.getRunnableRoutine("routine_archived")).toThrow(RoutineNotRunnableError);
      expect(store.getRunnableRoutine("routine_disabled", { includeDisabled: true })?.id).toBe(
        "routine_disabled",
      );
      expect(store.getRunnableRoutine("routine_archived", { includeArchived: true })?.id).toBe(
        "routine_archived",
      );
    } finally {
      store.close();
    }
  });

  test("stores routine runs and artifacts", async () => {
    const repoRoot = await tempRepo();
    const store = await RoutineStore.open({ repoRoot });
    const sessionStore = await SessionStore.open(repoRoot);
    try {
      const routine = store.createRoutine(routineInput());
      const jobSession = await sessionStore.createSession({
        kind: "job",
        title: "Routine run",
      });

      const run = store.createRoutineRun({
        id: "routine_run_test",
        routineId: routine.id,
        routineVersion: routine.version,
        input: { date: "2026-05-29" },
        jobSessionId: jobSession.id,
        now: new Date("2026-05-29T13:00:00.000Z"),
      });

      const artifact = store.createRoutineArtifact({
        id: "routine_artifact_test",
        routineRunId: run.id,
        routineId: routine.id,
        schemaName: "daily_todos",
        schemaVersion: "1",
        payload: { date: "2026-05-29", candidates: [] },
        taskStatus: "no_op",
        dedupeKey: "daily_todos:2026-05-29",
        sourceRefs: [{ path: "wiki/raw/granola/meeting.md", quote: "No action items." }],
        sessionId: jobSession.id,
        now: new Date("2026-05-29T13:01:00.000Z"),
      });

      expect(store.getRoutineRun(run.id)?.outputArtifactIds).toEqual([artifact.id]);
      expect(store.listRoutineRuns({ routineId: routine.id })).toMatchObject([
        {
          id: run.id,
          status: "running",
          input: { date: "2026-05-29" },
        },
      ]);
      expect(store.listRoutineArtifacts({ routineRunId: run.id })).toEqual([artifact]);

      const completed = store.updateRoutineRun({
        id: run.id,
        status: "completed",
        taskStatus: "no_op",
        finishedAt: "2026-05-29T13:02:00.000Z",
      });

      expect(completed.status).toBe("completed");
      expect(completed.taskStatus).toBe("no_op");
      expect(completed.finishedAt).toBe("2026-05-29T13:02:00.000Z");
    } finally {
      sessionStore.close();
      store.close();
    }
  });
});

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "strata-routines-"));
  tempRoots.push(root);
  return root;
}

function routineInput(): CreateRoutineInput {
  return {
    id: "routine_test",
    name: "Test routine",
    description: "A test routine.",
    prompt: "Inspect local evidence and submit structured output.",
    inputSchema: {
      type: "object",
      properties: {
        date: { type: "string" },
      },
    },
    defaultInput: { date: "2026-05-29" },
    outputSchema: {
      type: "object",
      required: ["date"],
      properties: {
        date: { type: "string" },
      },
    },
    requiredSkills: ["routine-test"],
    preRunSteps: [{ jobName: "raw.index", input: { source: "granola" } }],
    publicationPolicy: { mode: "artifact_only" },
  };
}
