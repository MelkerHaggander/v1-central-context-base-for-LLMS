-- Alfredo runs this file at the v1.2 integration, after the team has manually
-- deleted the old memories and inserted space memberships. It contains no
-- DELETE and no backfill. Empty spaces make the new RLS rule blind: a memory
-- is visible only when its space_id has a row in space_members for the user.
-- Do not apply this file from the agent. Auth and OAuth functions are untouched.

create extension if not exists vector;

create table if not exists public.spaces (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  created_at timestamptz not null default now(),
  constraint spaces_kind_check check (kind in ('personal', 'shared'))
);

create table if not exists public.space_members (
  space_id uuid not null references public.spaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

alter table public.memories
  add column if not exists space_id uuid references public.spaces (id),
  add column if not exists embedding vector(3072),
  add column if not exists source text;

alter table public.memories
  drop constraint if exists memories_source_check;

alter table public.memories
  add constraint memories_source_check
  check (source is null or source in ('dashboard', 'brain'));

drop index if exists public.memories_identity_idx;

create unique index memories_identity_idx
  on public.memories (space_id, project, category, title, md5(content))
  where space_id is not null;

-- History outlives the memory. memory_id is not a foreign key, so removing a
-- memory keeps its versions. Each update and each delete adds one row: who,
-- event update or delete, and the text before and after. After a delete the
-- after-text is empty. Search only reads memories, so a deleted row disappears
-- there and stays here.
create table if not exists public.memory_versions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null,
  space_id uuid,
  changed_by uuid not null,
  event text not null,
  project text not null,
  category text not null,
  title_before text not null,
  title_after text not null,
  content_before text not null,
  content_after text not null,
  source text,
  version_number integer not null,
  created_at timestamptz not null default now(),
  constraint memory_versions_event_check check (event in ('update', 'delete')),
  constraint memory_versions_source_check
    check (source is null or source in ('dashboard', 'brain')),
  constraint memory_versions_number_unique unique (memory_id, version_number)
);

create index if not exists memory_versions_memory_id_idx
  on public.memory_versions (memory_id, version_number desc);

create index if not exists memories_embedding_cosine_idx
  on public.memories
  using hnsw (embedding vector_cosine_ops);

create or replace function public.match_memories(
  query_embedding vector(3072),
  space_ids uuid[],
  match_count integer
)
returns table (
  id uuid,
  project text,
  category text,
  title text,
  content text,
  created_at timestamptz,
  updated_at timestamptz,
  space_id uuid,
  source text,
  similarity double precision
)
language sql
stable
as $$
  select
    memory.id,
    memory.project,
    memory.category,
    memory.title,
    memory.content,
    memory.created_at,
    memory.updated_at,
    memory.space_id,
    memory.source,
    1 - (memory.embedding <=> query_embedding) as similarity
  from public.memories as memory
  where memory.space_id = any (space_ids)
    and memory.embedding is not null
  order by memory.embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_memory_neighbors(
  seed_ids uuid[],
  space_ids uuid[],
  min_similarity double precision,
  match_count integer
)
returns table (
  id uuid,
  project text,
  category text,
  title text,
  content text,
  created_at timestamptz,
  updated_at timestamptz,
  space_id uuid,
  source text,
  similarity double precision
)
language sql
stable
as $$
  select
    ranked.id,
    ranked.project,
    ranked.category,
    ranked.title,
    ranked.content,
    ranked.created_at,
    ranked.updated_at,
    ranked.space_id,
    ranked.source,
    ranked.similarity
  from (
    select distinct on (neighbor.id)
      neighbor.id,
      neighbor.project,
      neighbor.category,
      neighbor.title,
      neighbor.content,
      neighbor.created_at,
      neighbor.updated_at,
      neighbor.space_id,
      neighbor.source,
      1 - (neighbor.embedding <=> seed.embedding) as similarity
    from public.memories as seed
    join public.memories as neighbor
      on neighbor.id <> seed.id
     and neighbor.space_id = any (space_ids)
     and neighbor.embedding is not null
    where seed.id = any (seed_ids)
      and seed.embedding is not null
      and 1 - (neighbor.embedding <=> seed.embedding) >= min_similarity
    order by neighbor.id, neighbor.embedding <=> seed.embedding
  ) as ranked
  order by ranked.similarity desc
  limit match_count;
$$;

alter table public.spaces enable row level security;
alter table public.space_members enable row level security;
alter table public.memory_versions enable row level security;

drop policy if exists memories_select_own on public.memories;
drop policy if exists memories_insert_own on public.memories;
drop policy if exists memories_update_own on public.memories;
drop policy if exists memories_delete_own on public.memories;

create policy memories_select_member
  on public.memories
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memories.space_id
        and member.user_id = (select auth.uid())
    )
  );

create policy memories_insert_member
  on public.memories
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memories.space_id
        and member.user_id = (select auth.uid())
    )
  );

create policy memories_update_member
  on public.memories
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memories.space_id
        and member.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memories.space_id
        and member.user_id = (select auth.uid())
    )
  );

create policy memories_delete_member
  on public.memories
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memories.space_id
        and member.user_id = (select auth.uid())
    )
  );

create policy memory_versions_select_member
  on public.memory_versions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memory_versions.space_id
        and member.user_id = (select auth.uid())
    )
  );

create policy memory_versions_insert_member
  on public.memory_versions
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = memory_versions.space_id
        and member.user_id = (select auth.uid())
    )
  );

create policy spaces_select_member
  on public.spaces
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.space_members as member
      where member.space_id = spaces.id
        and member.user_id = (select auth.uid())
    )
  );

create policy space_members_select_self
  on public.space_members
  for select
  to authenticated
  using (user_id = (select auth.uid()));

grant select on public.spaces to authenticated;
grant select on public.space_members to authenticated;
grant select, insert on public.memory_versions to authenticated;

revoke all on function public.match_memories(vector, uuid[], integer) from public;
revoke all on function public.match_memory_neighbors(uuid[], uuid[], double precision, integer) from public;
grant execute on function public.match_memories(vector, uuid[], integer) to authenticated;
grant execute on function public.match_memory_neighbors(uuid[], uuid[], double precision, integer) to authenticated;

-- Token path for chat. New functions only. Existing auth, OAuth and memory
-- RPCs are left as they are. Each one resolves the caller with
-- mcp_session_owner(p_access) and checks space_members.

create or replace function public.mcp_upsert_subject(
  p_access text,
  p_space_id uuid,
  p_project text,
  p_category text,
  p_title text,
  p_content text,
  p_source text
) returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
  row public.memories;
  next_number integer;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;
  if not exists (
    select 1
    from public.space_members as member
    where member.space_id = p_space_id
      and member.user_id = uid
  ) then
    return null;
  end if;

  select * into row
  from public.memories
  where space_id = p_space_id
    and project = p_project
    and category = p_category
    and title = p_title
  limit 1;

  if found then
    if row.content = p_content then
      return jsonb_build_object(
        'kind', 'unchanged',
        'row', jsonb_build_object(
          'id', row.id,
          'project', row.project,
          'category', row.category,
          'title', row.title,
          'content', row.content,
          'created_at', row.created_at,
          'updated_at', row.updated_at
        )
      );
    end if;

    select coalesce(max(version.version_number), 0) + 1
      into next_number
    from public.memory_versions as version
    where version.memory_id = row.id;

    insert into public.memory_versions (
      memory_id, space_id, changed_by, event, project, category,
      title_before, title_after, content_before, content_after, source, version_number
    ) values (
      row.id, row.space_id, uid, 'update', row.project, row.category,
      row.title, row.title, row.content, p_content, row.source, next_number
    );

    update public.memories
    set content = p_content, embedding = null
    where id = row.id
    returning * into row;

    return jsonb_build_object(
      'kind', 'updated',
      'row', jsonb_build_object(
        'id', row.id,
        'project', row.project,
        'category', row.category,
        'title', row.title,
        'content', row.content,
        'created_at', row.created_at,
        'updated_at', row.updated_at
      )
    );
  end if;

  insert into public.memories (
    user_id, space_id, project, category, title, content, source
  ) values (
    uid, p_space_id, p_project, p_category, p_title, p_content, p_source
  )
  returning * into row;

  return jsonb_build_object(
    'kind', 'created',
    'row', jsonb_build_object(
      'id', row.id,
      'project', row.project,
      'category', row.category,
      'title', row.title,
      'content', row.content,
      'created_at', row.created_at,
      'updated_at', row.updated_at
    )
  );
exception
  when unique_violation then
    return jsonb_build_object('kind', 'failed');
end;
$$;

create or replace function public.mcp_set_embedding(
  p_access text,
  p_id uuid,
  p_embedding vector(3072)
) returns void
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return;
  end if;
  update public.memories
  set embedding = p_embedding
  where id = p_id
    and exists (
      select 1
      from public.space_members as member
      where member.space_id = memories.space_id
        and member.user_id = uid
    );
end;
$$;

create or replace function public.mcp_has_embedding(
  p_access text,
  p_id uuid
) returns boolean
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
  present boolean;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return false;
  end if;
  select memory.embedding is not null
    into present
  from public.memories as memory
  where memory.id = p_id
    and exists (
      select 1
      from public.space_members as member
      where member.space_id = memory.space_id
        and member.user_id = uid
    );
  return coalesce(present, false);
end;
$$;

create or replace function public.mcp_list_by_spaces(
  p_access text,
  p_space_ids uuid[]
) returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', memory.id,
      'project', memory.project,
      'category', memory.category,
      'title', memory.title,
      'content', memory.content,
      'created_at', memory.created_at,
      'updated_at', memory.updated_at
    ))
    from public.memories as memory
    where memory.space_id = any (p_space_ids)
      and exists (
        select 1
        from public.space_members as member
        where member.space_id = memory.space_id
          and member.user_id = uid
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_list_nearest(
  p_access text,
  p_query_embedding vector(3072),
  p_space_ids uuid[],
  p_match_count integer
) returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', hit.id,
      'project', hit.project,
      'category', hit.category,
      'title', hit.title,
      'content', hit.content,
      'created_at', hit.created_at,
      'updated_at', hit.updated_at,
      'similarity', hit.similarity
    ) order by hit.similarity desc)
    from (
      select
        memory.id,
        memory.project,
        memory.category,
        memory.title,
        memory.content,
        memory.created_at,
        memory.updated_at,
        1 - (memory.embedding <=> p_query_embedding) as similarity
      from public.memories as memory
      where memory.space_id = any (p_space_ids)
        and memory.embedding is not null
        and exists (
          select 1
          from public.space_members as member
          where member.space_id = memory.space_id
            and member.user_id = uid
        )
      order by memory.embedding <=> p_query_embedding
      limit p_match_count
    ) as hit
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_list_neighbors(
  p_access text,
  p_seed_ids uuid[],
  p_space_ids uuid[],
  p_min_similarity double precision,
  p_match_count integer
) returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', hit.id,
      'project', hit.project,
      'category', hit.category,
      'title', hit.title,
      'content', hit.content,
      'created_at', hit.created_at,
      'updated_at', hit.updated_at,
      'similarity', hit.similarity
    ) order by hit.similarity desc)
    from (
      select
        ranked.id,
        ranked.project,
        ranked.category,
        ranked.title,
        ranked.content,
        ranked.created_at,
        ranked.updated_at,
        ranked.similarity
      from (
        select distinct on (neighbor.id)
          neighbor.id,
          neighbor.project,
          neighbor.category,
          neighbor.title,
          neighbor.content,
          neighbor.created_at,
          neighbor.updated_at,
          1 - (neighbor.embedding <=> seed.embedding) as similarity
        from public.memories as seed
        join public.memories as neighbor
          on neighbor.id <> seed.id
         and neighbor.space_id = any (p_space_ids)
         and neighbor.embedding is not null
         and exists (
           select 1
           from public.space_members as member
           where member.space_id = neighbor.space_id
             and member.user_id = uid
         )
        where seed.id = any (p_seed_ids)
          and seed.embedding is not null
          and 1 - (neighbor.embedding <=> seed.embedding) >= p_min_similarity
        order by neighbor.id, neighbor.embedding <=> seed.embedding
      ) as ranked
      order by ranked.similarity desc
      limit p_match_count
    ) as hit
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_list_identities(
  p_access text,
  p_space_ids uuid[],
  p_limit integer
) returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'project', identity.project,
      'category', identity.category,
      'title', identity.title,
      'updated_at', identity.updated_at
    ) order by identity.updated_at desc)
    from (
      select memory.project, memory.category, memory.title, memory.updated_at
      from public.memories as memory
      where memory.space_id = any (p_space_ids)
        and exists (
          select 1
          from public.space_members as member
          where member.space_id = memory.space_id
            and member.user_id = uid
        )
      order by memory.updated_at desc
      limit p_limit
    ) as identity
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_list_versions(
  p_access text,
  p_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'version_number', version.version_number,
      'memory_id', version.memory_id,
      'space_id', version.space_id,
      'changed_by', version.changed_by,
      'event', version.event,
      'project', version.project,
      'category', version.category,
      'title_before', version.title_before,
      'title_after', version.title_after,
      'content_before', version.content_before,
      'content_after', version.content_after,
      'source', version.source,
      'created_at', version.created_at
    ) order by version.version_number desc)
    from public.memory_versions as version
    where version.memory_id = p_id
      and exists (
        select 1
        from public.space_members as member
        where member.space_id = version.space_id
          and member.user_id = uid
      )
  ), '[]'::jsonb);
end;
$$;

create or replace function public.mcp_space_of(
  p_access text,
  p_id uuid
) returns uuid
language plpgsql
security definer
set search_path = private, public
as $$
declare
  uid uuid;
  found_space uuid;
begin
  uid := public.mcp_session_owner(p_access);
  if uid is null then
    return null;
  end if;

  select memory.space_id into found_space
  from public.memories as memory
  where memory.id = p_id
    and exists (
      select 1
      from public.space_members as member
      where member.space_id = memory.space_id
        and member.user_id = uid
    );
  if found_space is not null then
    return found_space;
  end if;

  select version.space_id into found_space
  from public.memory_versions as version
  where version.memory_id = p_id
    and exists (
      select 1
      from public.space_members as member
      where member.space_id = version.space_id
        and member.user_id = uid
    )
  order by version.version_number desc
  limit 1;
  return found_space;
end;
$$;

revoke all on function public.mcp_upsert_subject(text, uuid, text, text, text, text, text) from public;
revoke all on function public.mcp_set_embedding(text, uuid, vector) from public;
revoke all on function public.mcp_has_embedding(text, uuid) from public;
revoke all on function public.mcp_list_by_spaces(text, uuid[]) from public;
revoke all on function public.mcp_list_nearest(text, vector, uuid[], integer) from public;
revoke all on function public.mcp_list_neighbors(text, uuid[], uuid[], double precision, integer) from public;
revoke all on function public.mcp_list_identities(text, uuid[], integer) from public;
revoke all on function public.mcp_list_versions(text, uuid) from public;
revoke all on function public.mcp_space_of(text, uuid) from public;

grant execute on function public.mcp_upsert_subject(text, uuid, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.mcp_set_embedding(text, uuid, vector) to anon, authenticated, service_role;
grant execute on function public.mcp_has_embedding(text, uuid) to anon, authenticated, service_role;
grant execute on function public.mcp_list_by_spaces(text, uuid[]) to anon, authenticated, service_role;
grant execute on function public.mcp_list_nearest(text, vector, uuid[], integer) to anon, authenticated, service_role;
grant execute on function public.mcp_list_neighbors(text, uuid[], uuid[], double precision, integer) to anon, authenticated, service_role;
grant execute on function public.mcp_list_identities(text, uuid[], integer) to anon, authenticated, service_role;
grant execute on function public.mcp_list_versions(text, uuid) to anon, authenticated, service_role;
grant execute on function public.mcp_space_of(text, uuid) to anon, authenticated, service_role;
