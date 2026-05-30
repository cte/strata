import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addWikiAction,
  deleteWikiAction,
  listWikiActions,
  updateWikiAction,
  type WikiActionAddInput,
  type WikiActionItem,
  type WikiActionOwnerFilter,
  type WikiActionStatusFilter,
  type WikiActionUpdateInput,
} from "@/lib/api";
import { qk } from "./keys";

export function useWikiActions(input: {
  owner: WikiActionOwnerFilter;
  status: WikiActionStatusFilter;
  query: string;
}) {
  return useQuery<WikiActionItem[]>({
    queryKey: [...qk.wiki.actions, input.owner, input.status, input.query],
    queryFn: () => listWikiActions(input),
  });
}

function useInvalidateWikiActions() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.wiki.actions });
  };
}

export function useAddWikiAction() {
  const invalidate = useInvalidateWikiActions();
  return useMutation({
    mutationFn: (input: WikiActionAddInput) => addWikiAction(input),
    onSuccess: invalidate,
  });
}

export function useUpdateWikiAction() {
  const invalidate = useInvalidateWikiActions();
  return useMutation({
    mutationFn: (input: WikiActionUpdateInput) => updateWikiAction(input),
    onSuccess: invalidate,
  });
}

export function useDeleteWikiAction() {
  const invalidate = useInvalidateWikiActions();
  return useMutation({
    mutationFn: (id: string) => deleteWikiAction(id),
    onSuccess: invalidate,
  });
}
