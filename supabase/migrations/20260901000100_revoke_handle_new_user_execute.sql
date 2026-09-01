-- handle_new_user() is a SECURITY DEFINER trigger function. PostgREST exposes
-- every public function as an RPC endpoint, so without this it is reachable at
-- /rest/v1/rpc/handle_new_user by anon and authenticated callers. It only runs
-- meaningfully inside its trigger context, but a definer-rights function should
-- not be callable from the API surface at all.

revoke execute on function public.handle_new_user() from public, anon, authenticated;
