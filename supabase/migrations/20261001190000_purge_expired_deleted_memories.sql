-- Deleted memories stay restorable for 30 days, then leave the database for good.
-- pg_cron runs this daily so purge does not depend on anyone opening Deleted.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.purge_expired_deleted_memories()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  -- Drop every version row for memories whose delete event is older than 30 days.
  with expired as (
    select memory_id
    from public.memory_versions
    where event = 'delete'
      and created_at < timezone('utc', now()) - interval '30 days'
  ),
  gone as (
    delete from public.memory_versions as version
    using expired
    where version.memory_id = expired.memory_id
    returning version.memory_id
  )
  select count(*)::integer into removed from gone;

  return coalesce(removed, 0);
end;
$$;

revoke all on function public.purge_expired_deleted_memories() from public;
revoke all on function public.purge_expired_deleted_memories() from anon, authenticated;
grant execute on function public.purge_expired_deleted_memories() to postgres;

-- One daily run at 03:00 UTC. Re-schedule safely if this migration is reapplied.
do $$
declare
  existing bigint;
begin
  select j.jobid into existing
  from cron.job as j
  where j.jobname = 'purge-expired-deleted-memories'
  limit 1;
  if existing is not null then
    perform cron.unschedule(existing);
  end if;
  perform cron.schedule(
    'purge-expired-deleted-memories',
    '0 3 * * *',
    $cron$select public.purge_expired_deleted_memories()$cron$
  );
end;
$$;
