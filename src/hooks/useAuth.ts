import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import type { SessionResponse } from "../lib/types";

export function useAuth() {
  const query = useQuery({
    queryKey: ["session"],
    queryFn: () => api.me(),
    staleTime: 30_000,
  });

  return {
    loading: query.isLoading,
    user: query.data?.user ?? null,
  };
}

export function useSignOut() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.signOut(),
    onSuccess: () => {
      queryClient.setQueryData<SessionResponse>(["session"], { user: null });
      void queryClient.invalidateQueries();
    },
  });
}
