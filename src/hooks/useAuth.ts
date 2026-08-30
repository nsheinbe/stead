import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Session, User } from "@supabase/supabase-js";
import { useEffect } from "react";
import { supabaseConfigured } from "../lib/env";
import { getSupabase } from "../lib/supabase";

export function useAuth() {
  const queryClient = useQueryClient();
  const enabled = supabaseConfigured();

  const query = useQuery({
    queryKey: ["auth", "session"],
    enabled,
    queryFn: async (): Promise<{ session: Session | null; user: User | null }> => {
      const { data, error } = await getSupabase().auth.getSession();
      if (error) throw error;
      return { session: data.session, user: data.session?.user ?? null };
    },
  });

  useEffect(() => {
    if (!enabled) return;
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      queryClient.setQueryData(["auth", "session"], {
        session,
        user: session?.user ?? null,
      });
    });
    return () => data.subscription.unsubscribe();
  }, [enabled, queryClient]);

  return {
    configured: enabled,
    loading: enabled && query.isLoading,
    session: query.data?.session ?? null,
    user: query.data?.user ?? null,
  };
}
