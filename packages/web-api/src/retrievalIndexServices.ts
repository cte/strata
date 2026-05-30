import { getWikiSearchIndexStatus, type WikiSearchIndexStatus } from "@strata/core";
import { createDefaultJobRegistry, type JobExecutionResult, runJob } from "@strata/jobs";
import { repoRoot, runtimeEnv, type WebApiOptions } from "./runtime.js";
import type { RetrievalIndexRefreshRpcInput } from "./trpc.js";

export interface RetrievalIndexRefreshResult {
  run: JobExecutionResult;
  status: WikiSearchIndexStatus;
}

export function getRetrievalIndexStatusForWeb(
  options: WebApiOptions,
): Promise<WikiSearchIndexStatus> {
  return getWikiSearchIndexStatus({ repoRoot: repoRoot(options) });
}

export async function refreshRetrievalIndexForWeb(
  input: RetrievalIndexRefreshRpcInput,
  options: WebApiOptions,
): Promise<RetrievalIndexRefreshResult> {
  const root = repoRoot(options);
  const run = await runJob({
    jobName: "wiki.search-index.refresh",
    input: {
      source: input.source,
      includeRaw: input.includeRaw,
    },
    repoRoot: root,
    env: runtimeEnv(options),
    registry: createDefaultJobRegistry(),
    title: "Refresh wiki retrieval index",
  });
  return {
    run,
    status: await getWikiSearchIndexStatus({ repoRoot: root }),
  };
}
