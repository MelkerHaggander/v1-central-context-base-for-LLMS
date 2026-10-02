-- Alfredo kör den här filen vid integrationen av v1.2, efter
-- supabase/migrations/20260926120000_v12_brain_vectors.sql.
-- Den skapar platserna och medlemskapen. Den raderar inga minnen.
-- Kör den inte innan tabellerna spaces och space_members finns.

insert into public.spaces (id, kind)
select '11111111-1111-4111-8111-111111111111', 'personal'
where not exists (
  select 1
  from public.spaces as space
  join public.space_members as member on member.space_id = space.id
  join auth.users as account on account.id = member.user_id
  where space.kind = 'personal'
    and account.email = 'alfredo.test@example.com'
);

insert into public.spaces (id, kind)
select '22222222-2222-4222-8222-222222222222', 'personal'
where not exists (
  select 1
  from public.spaces as space
  join public.space_members as member on member.space_id = space.id
  join auth.users as account on account.id = member.user_id
  where space.kind = 'personal'
    and account.email = 'filip.test@example.com'
);

insert into public.spaces (id, kind)
select '33333333-3333-4333-8333-333333333333', 'personal'
where not exists (
  select 1
  from public.spaces as space
  join public.space_members as member on member.space_id = space.id
  join auth.users as account on account.id = member.user_id
  where space.kind = 'personal'
    and account.email = 'melker.test@example.com'
);

insert into public.spaces (id, kind)
select '44444444-4444-4444-8444-444444444444', 'shared'
where not exists (
  select 1 from public.spaces where kind = 'shared'
);

insert into public.space_members (space_id, user_id)
select space.id, account.id
from public.spaces as space
join auth.users as account on account.email = 'alfredo.test@example.com'
where space.kind = 'personal'
  and space.id = '11111111-1111-4111-8111-111111111111'
on conflict (space_id, user_id) do nothing;

insert into public.space_members (space_id, user_id)
select space.id, account.id
from public.spaces as space
join auth.users as account on account.email = 'filip.test@example.com'
where space.kind = 'personal'
  and space.id = '22222222-2222-4222-8222-222222222222'
on conflict (space_id, user_id) do nothing;

insert into public.space_members (space_id, user_id)
select space.id, account.id
from public.spaces as space
join auth.users as account on account.email = 'melker.test@example.com'
where space.kind = 'personal'
  and space.id = '33333333-3333-4333-8333-333333333333'
on conflict (space_id, user_id) do nothing;

insert into public.space_members (space_id, user_id)
select space.id, account.id
from public.spaces as space
join auth.users as account
  on account.email in (
    'alfredo.test@example.com',
    'filip.test@example.com',
    'melker.test@example.com'
  )
where space.kind = 'shared'
on conflict (space_id, user_id) do nothing;
