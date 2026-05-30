import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getRetrievalIndexStatus,
  type RetrievalIndexRefreshInput,
  type RetrievalIndexRefreshResult,
  type RetrievalIndexStatus,
  refreshRetrievalIndex,
} from "@/lib/api";
import { qk } from "./keys";

export function useRetrievalIndexStatus() {
  return useQuery<RetrievalIndexStatus>({
    queryKey: qk.system.retrievalIndex,
    queryFn: () => getRetrievalIndexStatus(),
  });
}

export function useRefreshRetrievalIndex() {
  const queryClient = useQueryClient();
  return useMutation<RetrievalIndexRefreshResult, Error, RetrievalIndexRefreshInput>({
    mutationFn: (input) => refreshRetrievalIndex(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.system.retrievalIndex });
      void queryClient.invalidateQueries({ queryKey: qk.activity.root });
    },
  });
}
