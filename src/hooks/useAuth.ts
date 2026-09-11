import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { clearAllDrafts } from "../lib/drafts";
import { clearLoginContext } from "../lib/loginContext";
import type { SessionResponse } from "../lib/types";

/**
 * Four states, not two. A failed session check (network down, API 5xx) is
 * `error`, which is retryable — it is never reported as "signed out", because
 * that would send a signed-in member to the sign-in form and, worse, let a
 * page treat their draft as someone else's.
 */
export type SessionStatus = "loading" | "signed_in" | "signed_out" | "error";

export function useAuth() {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: 30_000,
  });

  const status: SessionStatus = query.isPending
    ? "loading"
    : query.isError
      ? "error"
      : query.data?.user
        ? "signed_in"
        : "signed_out";

  return {
    status,
    loading: status === "loading",
    error: status === "error",
    user: query.data?.user ?? null,
    isOps: query.data?.isOps === true,
    refetch: () => query.refetch(),
  };
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => {
      // A shared browser must not hand the next member the previous one's
      // selections or sign-in destination.
      clearAllDrafts();
      clearLoginContext();
      queryClient.setQueryData<SessionResponse>(["session"], { user: null });
      void queryClient.invalidateQueries();
    },
  });
}
