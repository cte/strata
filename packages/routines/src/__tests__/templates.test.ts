import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RoutineStore } from "../store.js";
import { getRoutineTemplate, listRoutineTemplates, routineTemplateInput } from "../templates.js";

const tempRoots: string[] = [];

afterEach(async () => {
  for (const root of tempRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

async function tempRepo(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "strata-templates-"));
  tempRoots.push(root);
  return root;
}

describe("routine templates", () => {
  test("ships the four infra templates", () => {
    const keys = listRoutineTemplates().map((template) => template.key);
    expect(keys).toEqual(["granola-sync", "slack-sync", "index-refresh", "wiki-hygiene"]);
  });

  test("every template instantiates into a valid, disabled, read-only Routine", async () => {
    const repoRoot = await tempRepo();
    const store = await RoutineStore.open({ repoRoot });
    try {
      for (const template of listRoutineTemplates()) {
        const input = routineTemplateInput(template.key);
        expect(input).not.toBeNull();
        const routine = store.createRoutine(input as NonNullable<typeof input>);
        // A fresh id is generated; the template is not a standing system object.
        expect(routine.id).toMatch(/^routine_/);
        expect(routine.status).toBe("disabled");
        expect(routine.toolProfile).toBe("read-only");
        expect(routine.outputMode).toBe("none");
        expect(routine.preRunSteps.length).toBeGreaterThan(0);
      }
      // Four distinct routines were created.
      expect(store.listRoutines({}).length).toBe(4);
    } finally {
      store.close();
    }
  });

  test("getRoutineTemplate returns null for an unknown key", () => {
    expect(getRoutineTemplate("nope")).toBeNull();
    expect(routineTemplateInput("nope")).toBeNull();
  });
});
