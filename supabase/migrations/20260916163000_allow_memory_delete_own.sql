-- Dashboard users may delete their own rows. MCP has no delete tool and no
-- delete RPC, so language models cannot take this path.
grant delete on table public.memories to authenticated;

create policy memories_delete_own
  on public.memories
  for delete
  to authenticated
  using (user_id = (select auth.uid()));
