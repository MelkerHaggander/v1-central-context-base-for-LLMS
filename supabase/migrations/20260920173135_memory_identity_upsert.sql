-- Keep the newest value for each logical memory before enforcing the new
-- save_memory upsert identity.
with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, project, category, title
      order by updated_at desc, id desc
    ) as position
  from public.memories
)
delete from public.memories as memory
using ranked
where memory.id = ranked.id
  and ranked.position > 1;

drop index if exists public.memories_identical_duplicate_idx;

create unique index memories_identity_idx
  on public.memories (user_id, project, category, title);
