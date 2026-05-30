import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  acceptProposal,
  deferProposal,
  getProposal,
  listProposals,
  type ProposalDetail,
  type ProposalStatusFilter,
  type ProposalSummary,
  rejectProposal,
} from "@/lib/api";
import { qk } from "./keys";

export function useProposals(status: ProposalStatusFilter) {
  return useQuery<ProposalSummary[]>({
    queryKey: qk.proposals.list(status ?? "all"),
    queryFn: () => listProposals({ status, limit: 100 }),
  });
}

export function useProposal(id: string | null) {
  return useQuery<ProposalDetail | null>({
    queryKey: qk.proposals.detail(id ?? ""),
    queryFn: () => getProposal(id as string),
    enabled: id !== null,
  });
}

/** Accept / reject / defer all invalidate the whole proposals tree on success. */
export function useAcceptProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; previewFingerprint?: string }) =>
      acceptProposal(input.id, undefined, input.previewFingerprint),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.proposals.root }),
  });
}

export function useRejectProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) => rejectProposal(input.id, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.proposals.root }),
  });
}

export function useDeferProposal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; reason?: string }) => deferProposal(input.id, input.reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.proposals.root }),
  });
}
