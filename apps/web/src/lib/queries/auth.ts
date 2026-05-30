import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getWebAuthStatus, logoutWeb, unlockWeb, type WebAuthStatus } from "@/lib/api";
import { qk } from "./keys";

export function useWebAuthStatus() {
  return useQuery({
    queryKey: qk.auth.status,
    queryFn: getWebAuthStatus,
    retry: false,
    staleTime: 10_000,
  });
}

export function useUnlockWeb() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlockWeb,
    onSuccess: (status: WebAuthStatus) => {
      queryClient.setQueryData(qk.auth.status, status);
      void queryClient.invalidateQueries({ queryKey: qk.auth.root });
    },
  });
}

export function useLogoutWeb() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: logoutWeb,
    onSuccess: (status: WebAuthStatus) => {
      queryClient.setQueryData(qk.auth.status, status);
      void queryClient.invalidateQueries();
    },
  });
}
