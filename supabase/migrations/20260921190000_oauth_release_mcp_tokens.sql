-- oauth_exchange_code is service_role only. The live token call returns 401,
-- so Claude and Grok finish password login, the code is saved, and then the
-- release never runs. No MCP session is handed to the client.
--
-- Do not grant oauth_exchange_code to anon: its argument is the PKCE challenge,
-- which is already in the authorize URL. This function takes the code_verifier
-- instead, hashes it here, and returns only the MCP tokens created at approve
-- time. Supabase access and refresh tokens are not in the result.
-- Old rows have no MCP columns and are not released.

alter table private.oauth_codes
  add column if not exists mcp_access_token text,
  add column if not exists mcp_refresh_token text;

create or replace function public.oauth_save_mcp_code(
  p_code text,
  p_client_id text,
  p_redirect_uri text,
  p_code_challenge text,
  p_mcp_access text,
  p_mcp_refresh text,
  p_user_id uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is distinct from p_user_id
     or coalesce(p_code, '') = ''
     or coalesce(p_client_id, '') = ''
     or coalesce(p_redirect_uri, '') = ''
     or coalesce(p_code_challenge, '') = ''
     or coalesce(p_mcp_access, '') = ''
     or coalesce(p_mcp_refresh, '') = '' then
    raise exception 'not allowed';
  end if;

  insert into private.oauth_codes (
    code, client_id, redirect_uri, code_challenge,
    access_token, refresh_token, mcp_access_token, mcp_refresh_token,
    user_id, expires_at
  ) values (
    p_code, p_client_id, p_redirect_uri, p_code_challenge,
    p_mcp_access, p_mcp_refresh, p_mcp_access, p_mcp_refresh,
    p_user_id, pg_catalog.now() + interval '10 minutes'
  );
end;
$$;

create or replace function public.oauth_release_mcp_tokens(
  p_code text,
  p_client_id text,
  p_redirect_uri text,
  p_code_verifier text
) returns table (
  access_token text,
  refresh_token text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_challenge text;
begin
  if coalesce(p_code, '') = ''
     or coalesce(p_client_id, '') = ''
     or coalesce(p_redirect_uri, '') = ''
     or coalesce(p_code_verifier, '') = '' then
    return;
  end if;

  v_challenge := rtrim(
    translate(
      encode(extensions.digest(convert_to(p_code_verifier, 'utf8'), 'sha256'), 'base64'),
      '+/',
      '-_'
    ),
    '='
  );

  return query
  delete from private.oauth_codes as c
  where c.code = p_code
    and c.client_id = p_client_id
    and c.redirect_uri = p_redirect_uri
    and c.code_challenge = v_challenge
    and c.expires_at > pg_catalog.now()
    and c.mcp_access_token is not null
    and c.mcp_refresh_token is not null
  returning c.mcp_access_token, c.mcp_refresh_token;
end;
$$;

revoke all on function public.oauth_save_mcp_code(text, text, text, text, text, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.oauth_release_mcp_tokens(text, text, text, text) from public, anon, authenticated, service_role;

grant execute on function public.oauth_save_mcp_code(text, text, text, text, text, text, uuid) to authenticated;
grant execute on function public.oauth_release_mcp_tokens(text, text, text, text) to anon, authenticated, service_role;

comment on function public.oauth_release_mcp_tokens(text, text, text, text) is
  'Release one-time MCP tokens after the code verifier matches. Does not return Supabase tokens. Does not require service_role.';
