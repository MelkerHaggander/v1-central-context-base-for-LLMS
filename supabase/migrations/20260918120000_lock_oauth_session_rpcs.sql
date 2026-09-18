-- Session RPCs are SECURITY DEFINER and wrote never-expiring MCP tokens.
-- The public anon key must not be able to create, read, or refresh those rows.
-- apps/api calls them with SUPABASE_SERVICE_ROLE_KEY after this change.
-- Deleting private.oauth_sessions invalidates existing (and forged) tokens.
-- Same MCP URL; users reconnect once. Auth users and memories are untouched.

revoke all on function public.oauth_create_session(text, text, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.oauth_get_session(text) from public, anon, authenticated;
revoke all on function public.oauth_reuse_session(text) from public, anon, authenticated;
revoke all on function public.oauth_update_supabase_tokens_for_user(uuid, text, text) from public, anon, authenticated;
revoke all on function public.oauth_update_supabase_tokens(text, text, text) from public, anon, authenticated;
revoke all on function public.oauth_rotate_session(text, text, text, timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.oauth_create_session(text, text, uuid, text, text, timestamptz, timestamptz) to service_role;
grant execute on function public.oauth_get_session(text) to service_role;
grant execute on function public.oauth_reuse_session(text) to service_role;
grant execute on function public.oauth_update_supabase_tokens_for_user(uuid, text, text) to service_role;
grant execute on function public.oauth_update_supabase_tokens(text, text, text) to service_role;
grant execute on function public.oauth_rotate_session(text, text, text, timestamptz, timestamptz) to service_role;

delete from private.oauth_sessions;
