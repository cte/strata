import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelAdapter, ModelRequest, ModelResponse } from "@strata/agent";
import { SessionStore, searchWikiSearchIndex } from "@strata/core";
import { writeConnectorConfigProfile } from "@strata/ingest/connectors";
import { RoutineStore } from "@strata/routines";
import { createDefaultJobRegistry } from "../registry.js";
import { runJob } from "../runner.js";

class SequenceModelAdapter implements ModelAdapter {
  readonly name = "routine-test-model";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly responses: ModelResponse[]) {}

  async complete(request: ModelRequest): Promise<ModelResponse> {
    const { onAssistantDelta: _omit, onReasoningDelta: _omitReasoning, ...rest } = request;
    this.requests.push(structuredClone(rest));
    const response = this.responses[this.index];
    this.index += 1;
    if (response === undefined) {
      throw new Error("No fake model response configured");
    }
    return response;
  }
}

describe("default job definitions", () => {
  test("registers routine.run jobs", () => {
    const registry = createDefaultJobRegistry();
    const job = registry.get("routine.run");
    expect(job).toBeDefined();
    expect(job?.mode).toBe("write");
    expect(job?.inputSchema).toMatchObject({
      required: ["routineId"],
      properties: {
        routineId: { type: "string" },
        input: { type: "object" },
      },
    });
  });

  test("routine.run merges default input and completes no-output routines", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-routine-run-job-"));
    const model = new SequenceModelAdapter([
      {
        content: "Routine complete.",
        finishReason: "stop",
        toolCalls: [],
      },
    ]);
    try {
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.createRoutine({
          id: "routine_no_output",
          name: "No output routine",
          description: "Completes without structured output.",
          prompt: "Summarize the input.",
          inputSchema: {
            type: "object",
            required: ["date"],
            properties: {
              date: { type: "string" },
              limit: { type: "number" },
            },
          },
          defaultInput: { date: "2026-05-29", limit: 10 },
          outputMode: "none",
          outputSchema: null,
        });
      } finally {
        routineStore.close();
      }

      const result = await runJob({
        jobName: "routine.run",
        input: {
          routineId: "routine_no_output",
          input: { limit: 2 },
        },
        repoRoot,
        registry: createDefaultJobRegistry({
          createModelAdapter: async () => model,
        }),
        now: new Date("2026-05-29T14:00:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("ok");
      expect(result.output?.metrics).toMatchObject({
        routineId: "routine_no_output",
        taskStatus: "no_op",
        toolCalls: 0,
      });
      expect(model.requests[0]?.messages.at(-1)?.content).toContain('"date": "2026-05-29"');
      expect(model.requests[0]?.messages.at(-1)?.content).toContain('"limit": 2');

      const store = await RoutineStore.open({ repoRoot });
      try {
        const [run] = store.listRoutineRuns({ routineId: "routine_no_output" });
        expect(run).toMatchObject({
          input: { date: "2026-05-29", limit: 2 },
          status: "completed",
          taskStatus: "no_op",
          jobSessionId: result.sessionId,
        });
        expect(run?.agentSessionId).toBeTruthy();
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("routine.run stops before agent start when a pre-run job fails", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-routine-pre-run-fail-"));
    let modelCreated = false;
    try {
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.createRoutine({
          id: "routine_pre_run_failure",
          name: "Pre-run failure",
          description: "Fails before the agent starts.",
          prompt: "This should not run.",
          inputSchema: { type: "object" },
          outputMode: "none",
          outputSchema: null,
          preRunSteps: [{ jobName: "missing.job", input: {} }],
        });
      } finally {
        routineStore.close();
      }

      const result = await runJob({
        jobName: "routine.run",
        input: { routineId: "routine_pre_run_failure" },
        repoRoot,
        registry: createDefaultJobRegistry({
          createModelAdapter: async () => {
            modelCreated = true;
            return new SequenceModelAdapter([]);
          },
        }),
      });

      expect(result.status).toBe("failed");
      expect(result.errorMessage).toContain("Unknown job: missing.job");
      expect(modelCreated).toBe(false);

      const store = await RoutineStore.open({ repoRoot });
      try {
        const [run] = store.listRoutineRuns({ routineId: "routine_pre_run_failure" });
        expect(run).toMatchObject({
          status: "failed",
          taskStatus: "failed",
          agentSessionId: null,
        });
        expect(run?.error).toContain("Unknown job: missing.job");
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("routine.run records child sessions for successful pre-run jobs", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-routine-pre-run-success-"));
    const model = new SequenceModelAdapter([
      {
        content: "Done.",
        finishReason: "stop",
        toolCalls: [],
      },
    ]);
    try {
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.createRoutine({
          id: "routine_with_pre_run",
          name: "Routine with pre-run",
          description: "Runs a child job first.",
          prompt: "Use prepared context.",
          inputSchema: { type: "object" },
          outputMode: "none",
          outputSchema: null,
          preRunSteps: [{ jobName: "wiki.search-index.refresh", input: { includeRaw: false } }],
        });
      } finally {
        routineStore.close();
      }

      const result = await runJob({
        jobName: "routine.run",
        input: { routineId: "routine_with_pre_run" },
        repoRoot,
        registry: createDefaultJobRegistry({
          createModelAdapter: async () => model,
        }),
      });

      expect(result.status).toBe("completed");
      const store = await RoutineStore.open({ repoRoot });
      try {
        const [run] = store.listRoutineRuns({ routineId: "routine_with_pre_run" });
        expect(run?.childSessionIds).toHaveLength(1);
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("routine.run persists valid structured output artifacts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-routine-output-valid-"));
    const output = {
      date: "2026-05-29",
      items: [{ title: "Send the follow-up", owner: "me" }],
      dedupeKey: "todos:2026-05-29",
      sourceRefs: [{ path: "wiki/raw/granola/meeting.md" }],
    };
    const model = new SequenceModelAdapter([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_output",
            name: "routine.output.submit",
            argumentsText: JSON.stringify(output),
          },
        ],
      },
      {
        content: "Submitted the TODO artifact.",
        finishReason: "stop",
        toolCalls: [],
      },
    ]);
    try {
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.createRoutine({
          id: "routine_structured_output",
          name: "Structured output routine",
          description: "Produces a schema-valid artifact.",
          prompt: "Create the TODO artifact.",
          inputSchema: { type: "object" },
          outputMode: "required",
          outputSchema: todoOutputSchema(),
          toolProfile: "read-only",
        });
      } finally {
        routineStore.close();
      }

      const result = await runJob({
        jobName: "routine.run",
        input: { routineId: "routine_structured_output" },
        repoRoot,
        registry: createDefaultJobRegistry({
          createModelAdapter: async () => model,
        }),
        now: new Date("2026-05-29T14:00:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("ok");
      expect(result.output?.metrics).toMatchObject({
        routineId: "routine_structured_output",
        taskStatus: "succeeded",
        toolCalls: 1,
      });
      expect(result.output?.metrics.outputArtifactIds).toHaveLength(1);
      expect(model.requests[0]?.tools.map((tool) => tool.name)).toContain("routine.output.submit");

      const store = await RoutineStore.open({ repoRoot });
      try {
        const [run] = store.listRoutineRuns({ routineId: "routine_structured_output" });
        expect(run).toBeDefined();
        if (run === undefined) {
          throw new Error("Expected routine run");
        }
        expect(run).toMatchObject({
          status: "completed",
          taskStatus: "succeeded",
        });
        expect(run.outputArtifactIds).toHaveLength(1);

        const artifacts = store.listRoutineArtifacts({ routineRunId: run.id });
        expect(artifacts).toHaveLength(1);
        expect(artifacts[0]).toMatchObject({
          routineId: "routine_structured_output",
          validationStatus: "valid",
          taskStatus: "succeeded",
          payload: output,
          dedupeKey: "todos:2026-05-29",
          sourceRefs: [{ path: "wiki/raw/granola/meeting.md" }],
        });
        const artifact = artifacts[0];
        expect(artifact).toBeDefined();
        expect(run.agentSessionId).not.toBeNull();
        if (artifact === undefined || run.agentSessionId === null) {
          throw new Error("Expected routine artifact and agent session");
        }
        expect(artifact.sessionId).toBe(run.agentSessionId);
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("routine.run rejects invalid structured output artifacts", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-routine-output-invalid-"));
    const model = new SequenceModelAdapter([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_invalid_output",
            name: "routine.output.submit",
            argumentsText: JSON.stringify({ items: [] }),
          },
        ],
      },
      {
        content: "I could not submit a valid artifact.",
        finishReason: "stop",
        toolCalls: [],
      },
    ]);
    try {
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.createRoutine({
          id: "routine_invalid_output",
          name: "Invalid output routine",
          description: "Attempts an invalid artifact.",
          prompt: "Create the TODO artifact.",
          inputSchema: { type: "object" },
          outputMode: "required",
          outputSchema: todoOutputSchema(),
        });
      } finally {
        routineStore.close();
      }

      const result = await runJob({
        jobName: "routine.run",
        input: { routineId: "routine_invalid_output" },
        repoRoot,
        registry: createDefaultJobRegistry({
          createModelAdapter: async () => model,
        }),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("needs_attention");
      expect(result.output?.metrics).toMatchObject({
        routineId: "routine_invalid_output",
        taskStatus: "needs_review",
        outputArtifactIds: [],
        toolCalls: 1,
      });

      const store = await RoutineStore.open({ repoRoot });
      try {
        const [run] = store.listRoutineRuns({ routineId: "routine_invalid_output" });
        expect(run).toBeDefined();
        if (run === undefined) {
          throw new Error("Expected routine run");
        }
        expect(run).toMatchObject({
          status: "completed",
          taskStatus: "needs_review",
          outputArtifactIds: [],
        });
        expect(store.listRoutineArtifacts({ routineRunId: run.id })).toHaveLength(0);
        expect(run.agentSessionId).not.toBeNull();
        if (run.agentSessionId === null) {
          throw new Error("Expected routine agent session");
        }
        const sessionStore = await SessionStore.open(repoRoot);
        try {
          const [toolResult] = sessionStore.listEvents(run.agentSessionId, "tool.result");
          expect(toolResult?.payload).toMatchObject({
            ok: false,
            error: {
              code: "routine_output_validation_failed",
            },
          });
        } finally {
          sessionStore.close();
        }
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("routine.run flags missing required output artifacts for review", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-routine-output-missing-"));
    const model = new SequenceModelAdapter([
      {
        content: "I found TODOs but did not submit them.",
        finishReason: "stop",
        toolCalls: [],
      },
    ]);
    try {
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        routineStore.createRoutine({
          id: "routine_missing_output",
          name: "Missing output routine",
          description: "Completes without the required artifact.",
          prompt: "Create the TODO artifact.",
          inputSchema: { type: "object" },
          outputMode: "required",
          outputSchema: todoOutputSchema(),
        });
      } finally {
        routineStore.close();
      }

      const result = await runJob({
        jobName: "routine.run",
        input: { routineId: "routine_missing_output" },
        repoRoot,
        registry: createDefaultJobRegistry({
          createModelAdapter: async () => model,
        }),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("needs_attention");
      expect(result.output?.metrics).toMatchObject({
        routineId: "routine_missing_output",
        taskStatus: "needs_review",
        outputArtifactIds: [],
        toolCalls: 0,
      });

      const store = await RoutineStore.open({ repoRoot });
      try {
        const [run] = store.listRoutineRuns({ routineId: "routine_missing_output" });
        expect(run).toMatchObject({
          status: "completed",
          taskStatus: "needs_review",
          outputArtifactIds: [],
        });
      } finally {
        store.close();
      }
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("connector.pull resolves config profiles at run time", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-connector-profile-job-"));
    try {
      const firstFixture = path.join(repoRoot, "first-granola.json");
      const secondFixture = path.join(repoRoot, "second-granola.json");
      await writeFile(firstFixture, granolaFixture("First Sync"), "utf8");
      await writeFile(secondFixture, granolaFixture("Second Sync"), "utf8");

      await writeConnectorConfigProfile({
        connector: "granola",
        id: "default",
        label: "Granola scheduled defaults",
        config: {
          fixture: firstFixture,
          since: "2026-05-01T00:00:00.000Z",
        },
        repoRoot,
        makeDefault: true,
      });

      const first = await runJob({
        jobName: "connector.pull",
        input: {
          connector: "granola",
          operation: "dry_run",
          configProfileId: "default",
        },
        repoRoot,
        registry: createDefaultJobRegistry(),
        now: new Date("2026-05-27T12:00:00.000Z"),
      });
      expect(first.status).toBe("completed");
      expect(JSON.stringify(first.output?.details)).toContain("First Sync");
      expect(first.output?.details).toMatchObject({
        configProfile: {
          id: "default",
          label: "Granola scheduled defaults",
        },
      });

      await writeConnectorConfigProfile({
        connector: "granola",
        id: "default",
        label: "Granola scheduled defaults",
        config: {
          fixture: secondFixture,
          since: "2026-05-01T00:00:00.000Z",
        },
        repoRoot,
        makeDefault: true,
      });

      const second = await runJob({
        jobName: "connector.pull",
        input: {
          connector: "granola",
          operation: "dry_run",
          configProfileId: "default",
        },
        repoRoot,
        registry: createDefaultJobRegistry(),
        now: new Date("2026-05-27T12:00:00.000Z"),
      });
      expect(second.status).toBe("completed");
      expect(JSON.stringify(second.output?.details)).toContain("Second Sync");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("wiki.hygiene stages entity proposals and refreshes retrieval", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-wiki-hygiene-"));
    try {
      await mkdir(path.join(repoRoot, "wiki", "projects"), { recursive: true });
      await writeFile(path.join(repoRoot, "wiki", "index.md"), "# Index\n", "utf8");
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roo-code.md"),
        "---\ntype: project\ntitle: Roo Code\n---\n# Roo Code\n\nCanonical project page.\n",
        "utf8",
      );
      await writeFile(
        path.join(repoRoot, "wiki", "projects", "roocodeinc-project-sync-from-slack-thread.md"),
        "---\ntype: project\ntitle: RooCodeInc project sync from Slack thread\n---\n# RooCodeInc project sync from Slack thread\n\nDuplicate context.\n",
        "utf8",
      );

      const result = await runJob({
        jobName: "wiki.hygiene",
        repoRoot,
        registry: createDefaultJobRegistry(),
        now: new Date("2026-05-27T12:00:00.000Z"),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("needs_attention");
      expect(result.output?.metrics).toMatchObject({
        findings: 1,
        proposals: 1,
        searchIndexed: 3,
      });
      expect(result.output?.summary).toContain("consolidation group");

      const matches = await searchWikiSearchIndex({
        repoRoot,
        query: "Roo Code",
        includeRaw: false,
      });
      expect(matches?.[0]?.kind).toBe("curated");
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });

  test("ingest.taxonomy.suggest seeds the routine, feeds evidence, and stages proposals", async () => {
    const repoRoot = await mkdtemp(path.join(os.tmpdir(), "strata-taxonomy-suggest-"));
    const suggestions = {
      suggestions: [
        {
          operation: {
            kind: "ingest.taxonomy.addProjectAlias",
            label: "Polsia",
            aliases: ["polsia"],
          },
          rationale: "Polsia recurs as a project across Granola syncs.",
          confidence: 0.9,
          sourceRefs: ["wiki/raw/granola/x.md"],
        },
        {
          // Malformed: no aliases — must be rejected by the deterministic gate.
          operation: { kind: "ingest.taxonomy.addProjectAlias", label: "Bad", aliases: [] },
          rationale: "broken",
          confidence: 0.9,
          sourceRefs: [],
        },
      ],
    };
    const model = new SequenceModelAdapter([
      {
        content: "",
        finishReason: "tool_calls",
        toolCalls: [
          {
            id: "call_output",
            name: "routine.output.submit",
            argumentsText: JSON.stringify(suggestions),
          },
        ],
      },
      { content: "Submitted taxonomy suggestions.", finishReason: "stop", toolCalls: [] },
    ]);
    try {
      const result = await runJob({
        jobName: "ingest.taxonomy.suggest",
        input: {},
        repoRoot,
        registry: createDefaultJobRegistry({ createModelAdapter: async () => model }),
      });

      expect(result.status).toBe("completed");
      expect(result.output?.status).toBe("ok");
      // One valid suggestion staged; the malformed one rejected.
      expect(result.output?.metrics).toMatchObject({ staged: 1, rejected: 1 });

      // The routine is now self-installed.
      const routineStore = await RoutineStore.open({ repoRoot });
      try {
        expect(routineStore.getRoutine("routine_taxonomy_suggestions")).not.toBeNull();
      } finally {
        routineStore.close();
      }

      // The pre-run evidence bundle reached the agent's prompt.
      const promptText = JSON.stringify(model.requests);
      expect(promptText).toContain("Pre-run job results");
      expect(promptText).toContain("ingest.taxonomy.evidence");

      // A reviewable schema proposal file was written.
      const proposalFiles = await readdir(path.join(repoRoot, ".strata", "proposals"));
      expect(proposalFiles.filter((name) => name.includes("-schema-"))).toHaveLength(1);
    } finally {
      await rm(repoRoot, { force: true, recursive: true });
    }
  });
});

function granolaFixture(title: string): string {
  return JSON.stringify({
    notes: [
      {
        id: title.toLowerCase().replace(/\s+/g, "_"),
        title,
        created_at: "2026-05-04T12:00:00.000Z",
        attendees: [{ name: "Ada" }],
        transcript: `Transcript for ${title}.`,
        url: `https://granola.ai/notes/${title.toLowerCase().replace(/\s+/g, "-")}`,
      },
    ],
  });
}

function todoOutputSchema() {
  return {
    type: "object",
    required: ["date", "items"],
    properties: {
      date: { type: "string" },
      dedupeKey: { type: "string" },
      sourceRefs: {
        type: "array",
        items: { type: "object" },
      },
      items: {
        type: "array",
        items: {
          type: "object",
          required: ["title"],
          properties: {
            title: { type: "string" },
            owner: { type: "string" },
          },
        },
      },
    },
  };
}
