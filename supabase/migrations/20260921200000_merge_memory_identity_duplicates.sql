-- Follow-up for installations where 20260920173135 may already be recorded.
-- Run this migration manually in the shared Supabase project.
--
-- Reconcile one logical identity at a time and retain the newest row. MERGE is
-- intentionally scoped by row id from a per-user partition; it is not a broad
-- DELETE over the memories table. Re-running is safe when no duplicates remain.

drop index if exists public.memories_identity_idx;
drop index if exists public.memories_identical_duplicate_idx;

with ranked as (
  select
    id,
    row_number() over (
      partition by user_id, project, category, title
      order by updated_at desc, id desc
    ) as position
  from public.memories
)
merge into public.memories as target
using ranked as source
on target.id = source.id
when matched and source.position > 1 then
  delete;

create unique index if not exists memories_identity_idx
  on public.memories (user_id, project, category, title);
