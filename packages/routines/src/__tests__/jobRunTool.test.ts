import { describe, expect, test } from "bun:test";
import type { ToolContext } from "@strata/tools";
import { createJobRunTool, type JobRunInput, type JobRunResult } from "../jobRunTool.js";

const context = {} as ToolContext;

function fakeRunner(): {
  calls: JobRunInput[];
  run: (input: JobRunInput) => Promise<JobRunResult>;
} {
  const calls: JobRunInput[] = [];
  return {
    calls,
    run: async (input) => {
      calls.push(input);
      return {
        sessionId: "session_123",
        jobName: input.jobName,
        status: "completed",
        summary: `ran ${input.jobName}`,
        errorMessage: null,
        output: null,
      };
    },
  };
}

describe("job.run tool", () => {
  test("runs a registered job through the injected runner and returns the result", async () => {
    const runner = fakeRunner();
    const tool = createJobRunTool({ runJob: runner.run });
    const result = await tool.handler(
      { jobName: "connector.pull", input: { connector: "slack" } },
      context,
    );
    expect(result).toEqual({
      jobName: "connector.pull",
      sessionId: "session_123",
      status: "completed",
      summary: "ran connector.pull",
      errorMessage: null,
    });
    expect(runner.calls).toEqual([
      {
        jobName: "connector.pull",
        input: { connector: "slack" },
        title: "job.run: connector.pull",
      },
    ]);
  });

  test("defaults input to an empty object", async () => {
    const runner = fakeRunner();
    const tool = createJobRunTool({ runJob: runner.run });
    await tool.handler({ jobName: "wiki.search-index.refresh" }, context);
    expect(runner.calls[0]?.input).toEqual({});
  });

  test("rejects routine.run (recursion guard)", async () => {
    const runner = fakeRunner();
    const tool = createJobRunTool({ runJob: runner.run });
    await expect(tool.handler({ jobName: "routine.run" }, context)).rejects.toThrow(
      /cannot run routine.run/,
    );
    expect(runner.calls).toHaveLength(0);
  });

  test("rejects an empty job name", async () => {
    const runner = fakeRunner();
    const tool = createJobRunTool({ runJob: runner.run });
    await expect(tool.handler({ jobName: "   " }, context)).rejects.toThrow(/non-empty jobName/);
    expect(runner.calls).toHaveLength(0);
  });
});
