-- A chat connection stays until the signed-in person removes it.
-- oauth_get_session is unchanged: the clock still does not end a connection.
-- The list returns an id and a time. It never returns the token.
-- Only the signed-in person can list or delete their own rows.

alter table private.oauth_sessions
  add column if not exists id uuid;

update private.oauth_sessions
set id = gen_random_uuid()
where id is null;

alter table private.oauth_sessions
  alter column id set default gen_random_uuid();

alter table private.oauth_sessions
  alter column id set not null;

create unique index if not exists oauth_sessions_id_key on private.oauth_sessions (id);

create or replace function public.oauth_list_my_sessions()
returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  return coalesce((
    select jsonb_agg(
      jsonb_build_object('id', session.id, 'created_at', session.created_at)
      order by session.created_at desc
    )
    from private.oauth_sessions as session
    where session.user_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

create or replace function public.oauth_revoke_my_session(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = private, public
as $$
declare
  removed integer;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  delete from private.oauth_sessions
  where id = p_id and user_id = auth.uid();
  get diagnostics removed = row_count;
  return removed = 1;
end;
$$;

create or replace function public.oauth_revoke_my_sessions()
returns integer
language plpgsql
security definer
set search_path = private, public
as $$
declare
  removed integer;
begin
  if auth.uid() is null then
    raise exception 'not allowed';
  end if;
  delete from private.oauth_sessions
  where user_id = auth.uid();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.oauth_list_my_sessions() from public, anon, authenticated, service_role;
revoke all on function public.oauth_revoke_my_session(uuid) from public, anon, authenticated, service_role;
revoke all on function public.oauth_revoke_my_sessions() from public, anon, authenticated, service_role;

grant execute on function public.oauth_list_my_sessions() to authenticated;
grant execute on function public.oauth_revoke_my_session(uuid) to authenticated;
grant execute on function public.oauth_revoke_my_sessions() to authenticated;
