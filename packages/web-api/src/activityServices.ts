import { getIngestActivityRun, listIngestActivity } from "@strata/ingest/activity";
import { repoRoot, type WebApiOptions } from "./runtime.js";
import type { ActivityGetRpcInput, ActivityListRpcInput } from "./trpc.js";

export function listIngestActivityForWeb(input: ActivityListRpcInput, options: WebApiOptions) {
  return listIngestActivity({
    repoRoot: repoRoot(options),
    limit: input.limit,
    source: input.source,
    writesOrIndexesOnly: input.writesOrIndexesOnly,
    ...(input.resultFilters === undefined ? {} : { resultFilters: input.resultFilters }),
  });
}

export function getIngestActivityForWeb(input: ActivityGetRpcInput, options: WebApiOptions) {
  return getIngestActivityRun({
    repoRoot: repoRoot(options),
    sessionId: input.sessionId,
    itemLimit: input.itemLimit,
    writesOrIndexesOnly: input.writesOrIndexesOnly,
    ...(input.resultFilters === undefined ? {} : { resultFilters: input.resultFilters }),
  });
}
