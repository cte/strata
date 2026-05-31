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

/**
 * How long the unlock screen lingers after a successful token exchange before
 * the gate swaps in the app, so the lock→unlock (red→green) animation is seen.
 */
const UNLOCK_TRANSITION_DELAY_MS = 900;

export function useUnlockWeb() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: unlockWeb,
    onSuccess: (status: WebAuthStatus) => {
      // Keep the mutation in its success state (unlocked icon visible) and delay
      // writing the authenticated status into the cache, which is what flips the
      // gate from the unlock screen to the app.
      setTimeout(() => {
        queryClient.setQueryData(qk.auth.status, status);
        void queryClient.invalidateQueries({ queryKey: qk.auth.root });
      }, UNLOCK_TRANSITION_DELAY_MS);
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
