-- Client account approvals. Apply to a dedicated Supabase Auth project.
-- Passwords remain managed by Supabase Auth, never by these tables.
begin;

create schema if not exists studio_private;
revoke all on schema studio_private from public, anon, authenticated;
grant usage on schema studio_private to authenticated;

create table public.studio_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null default '' check (char_length(display_name) <= 100),
  company text not null default '' check (char_length(company) <= 150),
  status text not null default 'pending' check (status in ('pending', 'approved', 'revoked')),
  email_verified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  decided_at timestamptz
);
create index studio_accounts_status_created on public.studio_accounts (status, created_at desc, user_id);
create index studio_accounts_created on public.studio_accounts (created_at desc, user_id);
alter table public.studio_accounts enable row level security;
revoke all on public.studio_accounts from public, anon, authenticated;
grant select on public.studio_accounts to authenticated;

-- Administrators are provisioned by the trusted project owner using a verified
-- Auth user UUID. Neither signup metadata nor an email typed into a form can
-- grant administrator privileges.
create table studio_private.administrators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table studio_private.administrators enable row level security;
revoke all on studio_private.administrators from public, anon, authenticated;

create table studio_private.approval_events (
  id bigint generated always as identity primary key,
  actor_id uuid not null,
  client_id uuid not null,
  previous_status text not null,
  new_status text not null,
  created_at timestamptz not null default now()
);
alter table studio_private.approval_events enable row level security;
revoke all on studio_private.approval_events from public, anon, authenticated;
revoke all on sequence studio_private.approval_events_id_seq from public, anon, authenticated;

create function studio_private.valid_session()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from auth.users u
    join auth.sessions s on s.user_id = u.id
    where u.id = auth.uid()
      and s.id::text = (auth.jwt() ->> 'session_id')
      and u.email_confirmed_at is not null
      and coalesce(u.is_anonymous, false) = false
      and (u.banned_until is null or u.banned_until <= now())
  );
$$;
revoke all on function studio_private.valid_session() from public, anon, authenticated;
grant execute on function studio_private.valid_session() to authenticated;

create function studio_private.is_admin()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and studio_private.valid_session() and exists (
    select 1 from studio_private.administrators a where a.user_id = auth.uid()
  );
$$;
revoke all on function studio_private.is_admin() from public, anon, authenticated;
grant execute on function studio_private.is_admin() to authenticated;

create policy studio_read_own_or_admin on public.studio_accounts
for select to authenticated
using (
  (select studio_private.valid_session()) and
  (user_id = (select auth.uid()) or (select studio_private.is_admin()))
);

create function studio_private.sync_auth_account()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.studio_accounts (user_id, email, display_name, company, email_verified)
    values (
      new.id, coalesce(new.email, ''),
      left(trim(coalesce(new.raw_user_meta_data ->> 'display_name', '')), 100),
      left(trim(coalesce(new.raw_user_meta_data ->> 'company', '')), 150),
      new.email_confirmed_at is not null
    );
  else
    update public.studio_accounts set
      email = coalesce(new.email, ''),
      email_verified = new.email_confirmed_at is not null,
      status = case when new.email is distinct from old.email then 'pending' else status end,
      decided_at = case when new.email is distinct from old.email then null else decided_at end,
      updated_at = now()
    where user_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function studio_private.sync_auth_account() from public, anon, authenticated;
create trigger studio_auth_account_created after insert on auth.users
for each row execute function studio_private.sync_auth_account();
create trigger studio_auth_account_updated after update of email, email_confirmed_at on auth.users
for each row execute function studio_private.sync_auth_account();

-- Existing Auth accounts are imported as pending, never automatically approved.
insert into public.studio_accounts (user_id, email, display_name, company, email_verified)
select id, coalesce(email, ''),
  left(trim(coalesce(raw_user_meta_data ->> 'display_name', '')), 100),
  left(trim(coalesce(raw_user_meta_data ->> 'company', '')), 150),
  email_confirmed_at is not null
from auth.users
on conflict (user_id) do nothing;

create function public.studio_access()
returns jsonb language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'account', (select to_jsonb(a) from public.studio_accounts a where a.user_id = auth.uid()),
    'is_admin', studio_private.is_admin()
  );
$$;
revoke all on function public.studio_access() from public, anon, authenticated;
grant execute on function public.studio_access() to authenticated;

create function studio_private.list_clients(p_status text, p_search text, p_offset integer)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare result jsonb;
begin
  if auth.uid() is null or not studio_private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if (p_status is not null and p_status not in ('pending', 'approved', 'revoked'))
    or p_offset is null or p_offset < 0 or p_offset > 100000
    or p_search is null or char_length(p_search) > 150 then
    raise exception 'Invalid client filter' using errcode = '22023';
  end if;
  with filtered as (
    select a.*, exists (select 1 from studio_private.administrators d where d.user_id = a.user_id) as is_admin
    from public.studio_accounts a
    where (p_status is null or a.status = p_status)
      and (p_search = '' or strpos(lower(a.display_name || ' ' || a.company || ' ' || a.email), lower(p_search)) > 0)
  ), page as (
    select * from filtered order by created_at desc, user_id limit 25 offset p_offset
  )
  select jsonb_build_object(
    'accounts', coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc, user_id) from page), '[]'::jsonb),
    'total', (select count(*) from filtered)
  ) into result;
  return result;
end;
$$;
revoke all on function studio_private.list_clients(text, text, integer) from public, anon, authenticated;
grant execute on function studio_private.list_clients(text, text, integer) to authenticated;

create function public.studio_list_clients(p_status text default null, p_search text default '', p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path = ''
as $$ select studio_private.list_clients(p_status, p_search, p_offset); $$;
revoke all on function public.studio_list_clients(text, text, integer) from public, anon, authenticated;
grant execute on function public.studio_list_clients(text, text, integer) to authenticated;

create function studio_private.set_client_status(p_user_id uuid, p_status text, p_expected_status text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare account public.studio_accounts;
begin
  if auth.uid() is null or not studio_private.is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  if p_user_id is null or p_status is null or p_status not in ('approved', 'revoked')
    or p_expected_status is null or p_expected_status not in ('pending', 'approved', 'revoked') then
    raise exception 'Invalid account decision' using errcode = '22023';
  end if;
  if exists (select 1 from studio_private.administrators where user_id = p_user_id) then
    raise exception 'Administrator accounts cannot be changed here' using errcode = '42501';
  end if;
  select * into account from public.studio_accounts where user_id = p_user_id for update;
  if not found then raise exception 'Account not found' using errcode = 'P0002'; end if;
  if account.status <> p_expected_status then
    raise exception 'Account changed; refresh before deciding' using errcode = '40001';
  end if;
  if p_status = 'approved' and not exists (
    select 1 from auth.users where id = p_user_id and email_confirmed_at is not null
      and coalesce(is_anonymous, false) = false and (banned_until is null or banned_until <= now())
  ) then
    raise exception 'A verified, active email account is required' using errcode = '42501';
  end if;
  if account.status = p_status then return to_jsonb(account); end if;
  insert into studio_private.approval_events (actor_id, client_id, previous_status, new_status)
  values (auth.uid(), p_user_id, account.status, p_status);
  update public.studio_accounts set status = p_status, updated_at = clock_timestamp(), decided_at = clock_timestamp()
  where user_id = p_user_id returning * into account;
  return to_jsonb(account);
end;
$$;
revoke all on function studio_private.set_client_status(uuid, text, text) from public, anon, authenticated;
grant execute on function studio_private.set_client_status(uuid, text, text) to authenticated;

create function public.studio_set_client_status(p_user_id uuid, p_status text, p_expected_status text)
returns jsonb language sql security invoker set search_path = ''
as $$ select studio_private.set_client_status(p_user_id, p_status, p_expected_status); $$;
revoke all on function public.studio_set_client_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.studio_set_client_status(uuid, text, text) to authenticated;

comment on schema studio_private is 'Internal client approval authority. Do not expose through the Data API.';
comment on table public.studio_accounts is 'Read-only to clients. Approval mutations require an authenticated administrator RPC.';
notify pgrst, 'reload schema';
commit;
