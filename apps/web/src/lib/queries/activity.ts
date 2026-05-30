import { useQuery } from "@tanstack/react-query";
import {
  getIngestActivity,
  type IngestActivityDetail,
  type IngestActivityResultFilter,
  type IngestActivityRun,
  type IngestActivitySource,
  listIngestActivity,
} from "@/lib/api";
import { qk } from "./keys";

/** Stable cache-key fragment for a result-filter selection. */
export function resultFilterKey(filters: IngestActivityResultFilter[]): string {
  return filters.length === 0 ? "all" : [...filters].sort().join(",");
}

export function useIngestActivity(input: {
  source: IngestActivitySource | "all";
  resultFilters: IngestActivityResultFilter[];
  limit?: number;
}) {
  const filters = input.resultFilters;
  return useQuery<IngestActivityRun[]>({
    queryKey: qk.activity.list(input.source ?? "all", resultFilterKey(filters)),
    queryFn: () =>
      listIngestActivity({
        limit: input.limit ?? 50,
        source: input.source,
        ...(filters.length > 0 ? { resultFilters: filters } : {}),
      }),
  });
}

/**
 * Lazy per-run detail. React Query caches each `(sessionId, filters)` pair, so
 * re-expanding a previously opened run is served from cache — replacing the
 * hand-rolled `details` map and skip-if-cached logic the route used to keep.
 */
export function useIngestActivityDetail(
  sessionId: string | null,
  resultFilters: IngestActivityResultFilter[],
) {
  return useQuery<IngestActivityDetail | null>({
    queryKey: qk.activity.detail(sessionId ?? "", resultFilterKey(resultFilters)),
    queryFn: () =>
      getIngestActivity(
        sessionId as string,
        200,
        resultFilters.length > 0 ? resultFilters : undefined,
      ),
    enabled: sessionId !== null,
  });
}
