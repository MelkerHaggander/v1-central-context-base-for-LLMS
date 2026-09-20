-- oauth_consume_code was SECURITY DEFINER, granted to anon, and deleted a row
-- by authorization code alone. It returned the user's Supabase access and
-- refresh tokens. PKCE in apps/api/app/oauth/token/route.ts ran after that, so
-- anyone with the public anon key and a stolen code could skip the verifier.
--
-- Replace it with a service_role-only exchange that matches code, client_id,
-- redirect_uri, PKCE challenge and expiry in the same DELETE. A mismatch
-- leaves the row in place. Do not edit older migrations; they may already
-- have run.

revoke all on function public.oauth_consume_code(text) from public, anon, authenticated, service_role;

drop function if exists public.oauth_consume_code(text);

create or replace function public.oauth_exchange_code(
  p_code text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text
)
returns table (
  user_id uuid,
  access_token text,
  refresh_token text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(p_code, '') = ''
     or coalesce(p_client_id, '') = ''
     or coalesce(p_redirect_uri, '') = ''
     or coalesce(p_code_challenge, '') = '' then
    return;
  end if;

  return query
  delete from private.oauth_codes as c
  where c.code = p_code
    and c.client_id = p_client_id
    and c.redirect_uri = p_redirect_uri
    and c.code_challenge = p_code_challenge
    and c.expires_at > pg_catalog.now()
    and c.refresh_token is not null
  returning c.user_id, c.access_token, c.refresh_token;
end;
$$;

revoke all on function public.oauth_exchange_code(text, text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.oauth_exchange_code(text, text, text, text) to service_role;

comment on function public.oauth_exchange_code(text, text, text, text) is
  'Service-role only. Atomically consume an OAuth authorization code after PKCE match. Returns only the tokens the token endpoint needs.';
