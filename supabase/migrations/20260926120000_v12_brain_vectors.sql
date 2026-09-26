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

create table if not exists public.memory_versions (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories (id) on delete cascade,
  space_id uuid,
  project text not null,
  category text not null,
  title text not null,
  content text not null,
  source text,
  version_number integer not null,
  created_at timestamptz not null default now(),
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
