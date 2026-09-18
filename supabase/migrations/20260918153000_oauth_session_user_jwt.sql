-- Grok/ChatGPT login broke after locking session RPCs to service_role:
-- Vercel often has no real service_role JWT on the deployment that serves MCP,
-- so oauth_create_session returned permission denied after the user logged in.
--
-- Create/update may only run as the signed-in user (auth.uid = p_user_id).
-- The OAuth token endpoint already has that user's Supabase JWT.
-- Get/reuse stay callable with the public anon key because the opaque MCP
-- token is the secret — you cannot forge a session for someone else.
-- Same MCP URL. Auth users and memories are untouched.

create or replace function public.oauth_create_session(
  p_access text,
  p_refresh text,
  p_user_id uuid,
  p_supabase_access text,
  p_supabase_refresh text,
  p_access_expires timestamptz,
  p_refresh_expires timestamptz
) returns void
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;
  insert into private.oauth_sessions (
    access_token, refresh_token, user_id, supabase_access, supabase_refresh,
    access_expires_at, refresh_expires_at
  ) values (
    p_access, p_refresh, p_user_id, p_supabase_access, p_supabase_refresh,
    timestamptz '9999-12-31 00:00:00+00',
    timestamptz '9999-12-31 00:00:00+00'
  );
end;
$$;

create or replace function public.oauth_update_supabase_tokens_for_user(
  p_user_id uuid,
  p_supabase_access text,
  p_supabase_refresh text
) returns void
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if auth.role() is distinct from 'service_role' and auth.uid() is distinct from p_user_id then
    raise exception 'not allowed';
  end if;
  update private.oauth_sessions
  set supabase_access = p_supabase_access, supabase_refresh = p_supabase_refresh
  where user_id = p_user_id;
end;
$$;

revoke all on function public.oauth_create_session(text, text, uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.oauth_update_supabase_tokens_for_user(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.oauth_get_session(text) from public, anon, authenticated, service_role;
revoke all on function public.oauth_reuse_session(text) from public, anon, authenticated, service_role;

grant execute on function public.oauth_create_session(text, text, uuid, text, text, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.oauth_update_supabase_tokens_for_user(uuid, text, text) to authenticated, service_role;
grant execute on function public.oauth_get_session(text) to anon, authenticated, service_role;
grant execute on function public.oauth_reuse_session(text) to anon, authenticated, service_role;
