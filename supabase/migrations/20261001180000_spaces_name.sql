-- Team display name for create/rename in the dashboard.
-- Nullable so existing personal/shared rows stay valid until renamed.
alter table public.spaces
  add column if not exists name text;
