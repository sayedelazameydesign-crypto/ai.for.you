-- Central quotas and entitlements for celia.sh.
--
-- Why this exists: the current limiter (server/ai.ts) counts in process
-- memory. `docs/AUDIT.md` A6 says so, and `docs/OPERATIONS.md` says the same.
-- That is fine for one deployment on one instance and wrong for a product: two
-- serverless instances do not share a counter, and a restart resets the day.
-- `scripts/unit-economics.mjs` shows the practical consequence — one heavy
-- request consumes most of the provider's per-minute budget — so a quota that
-- can be bypassed is not a limit at all.
--
-- Design rules applied here, deliberately:
--
--   1. The browser never writes these tables. RLS is enabled on every table,
--      default privileges from `PUBLIC` are revoked explicitly, and no write
--      grant or policy exists for `anon` or `authenticated`.
--   2. Usage is incremented through `private.consume_ai_quota`, isolated in a
--      locked-down `private` schema with `SECURITY DEFINER` and
--      `SET search_path = ''`. Concurrent requests for the same account
--      serialize on `SELECT ... FROM public.accounts ... FOR UPDATE OF a`, and
--      wall-clock time (`pg_catalog.clock_timestamp()`) is read only after the
--      row lock is acquired.
--   3. Per-minute burst protection (6 requests / 60 seconds) uses a sliding
--      window over `private.ai_rate_events`, pruned automatically per account,
--      rather than the daily rollup counter.
--   4. Authenticated callers reach the counter exclusively through
--      `public.consume_own_quota(text, integer)`, which binds `auth.uid()`
--      internally and revokes `EXECUTE` from `PUBLIC` and `anon`.
--   5. No prompt text, no IP addresses, no email — consistent with the privacy
--      posture in SECURITY.md.
--   6. Nothing here enables payments. It models entitlement, not billing.

-- Remove any legacy public raw counter from an earlier draft before locking down.
drop function if exists public.consume_ai_quota(uuid, text, integer);

-- ---------------------------------------------------------------------------
-- Private schema for internal definer state and functions
-- ---------------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
create table if not exists public.plans (
  id            text primary key,
  label_ar      text not null,
  monthly_cents integer not null check (monthly_cents >= 0),
  -- AI requests included per calendar month (UTC).
  ai_requests   integer not null check (ai_requests >= 0),
  -- Character ceiling for a single cloud request. Mirrors server/tools/*.ts.
  max_chars     integer not null check (max_chars between 80 and 12000),
  is_default    boolean not null default false,
  created_at    timestamptz not null default now()
);

-- Local tools stay free and unmetered on every plan, including this one.
insert into public.plans (id, label_ar, monthly_cents, ai_requests, max_chars, is_default)
values ('free', 'مجاني', 0, 20, 12000, true)
on conflict (id) do nothing;

insert into public.plans (id, label_ar, monthly_cents, ai_requests, max_chars)
values ('pro', 'احترافي', 400, 300, 12000)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Accounts
-- ---------------------------------------------------------------------------
create table if not exists public.accounts (
  -- Supabase auth user id. No email or name is duplicated here.
  user_id        uuid primary key references auth.users (id) on delete cascade,
  plan_id        text not null references public.plans (id) default 'free',
  -- Set by an operator or a future webhook. Never by the browser.
  status         text not null default 'active' check (status in ('active', 'past_due', 'cancelled', 'blocked')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Usage ledger (daily/monthly rollup) and ephemeral 60-second burst events
-- ---------------------------------------------------------------------------
create table if not exists public.ai_usage (
  -- One row per account per UTC day per tool. Aggregating per day keeps the
  -- table small enough to query on every request and prevents unbounded growth.
  user_id     uuid not null references public.accounts (user_id) on delete cascade,
  usage_day   date not null default (now() at time zone 'utc')::date,
  tool        text not null,
  requests    integer not null default 0 check (requests >= 0),
  chars_used  bigint  not null default 0 check (chars_used >= 0),
  updated_at  timestamptz not null default now(),
  primary key (user_id, usage_day, tool)
);

-- Monthly rollup, because the plan limit is monthly while the ledger is daily.
create index if not exists ai_usage_user_day_idx on public.ai_usage (user_id, usage_day);

-- Ephemeral per-request timestamps for the true 60-second sliding burst window.
-- Kept in `private` (never exposed to browser roles) and pruned per account on
-- every quota check so at most 6 rows per active account exist at once.
create table if not exists private.ai_rate_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.accounts (user_id) on delete cascade,
  occurred_at timestamptz not null
);

create index if not exists ai_rate_events_user_time_idx
  on private.ai_rate_events (user_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Atomic consumption (internal, private schema)
-- ---------------------------------------------------------------------------
-- Returns the used count after the request, or a reason code when refused.
-- `p_now` defaults to null and uses `pg_catalog.clock_timestamp()` after
-- acquiring the account row lock; only `service_role` / tests can pass `p_now`.
create or replace function private.consume_ai_quota(
  p_user    uuid,
  p_tool    text,
  p_chars   integer,
  p_now     timestamptz default null
)
returns table (allowed boolean, reason text, used integer, limit_value integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status        text;
  v_ai_requests   integer;
  v_max_chars     integer;
  v_now           timestamptz;
  v_today         date;
  v_month_start   date;
  v_next_month    date;
  v_month_used    integer;
  v_minute_used   integer;
begin
  if p_user is null then
    return query select false, 'unauthenticated'::text, 0, 0;
    return;
  end if;

  if p_tool is null or p_tool not in ('marketing', 'summary', 'code') then
    return query select false, 'invalid-tool'::text, 0, 0;
    return;
  end if;

  if p_chars is null or p_chars < 0 then
    return query select false, 'invalid-input'::text, 0, 0;
    return;
  end if;

  -- Lock only this account's row (`for update of a`), never the shared plans row.
  select a.status, p.ai_requests, p.max_chars
  into v_status, v_ai_requests, v_max_chars
  from public.accounts a
  join public.plans p on p.id = a.plan_id
  where a.user_id = p_user
  for update of a;

  if not found then
    return query select false, 'no-account'::text, 0, 0;
    return;
  end if;

  -- Read wall-clock time AFTER acquiring the lock so queued concurrent requests
  -- observe real elapsed time and previously committed burst events.
  v_now := coalesce(p_now, pg_catalog.clock_timestamp());
  v_today := (v_now at time zone 'utc')::date;
  v_month_start := pg_catalog.date_trunc('month', v_today::timestamp)::date;
  v_next_month := (pg_catalog.date_trunc('month', v_today::timestamp) + interval '1 month')::date;

  if v_status <> 'active' then
    return query select false, ('account-' || v_status)::text, 0, 0;
    return;
  end if;

  if p_chars > v_max_chars then
    return query select false, 'input-too-long'::text, 0, v_max_chars;
    return;
  end if;

  -- Monthly usage, counted from the daily ledger via an index-friendly range.
  select coalesce(sum(u.requests), 0)::integer
  into v_month_used
  from public.ai_usage u
  where u.user_id = p_user
    and u.usage_day >= v_month_start
    and u.usage_day < v_next_month;

  if v_month_used >= v_ai_requests then
    return query select false, 'monthly-limit'::text, v_month_used, v_ai_requests;
    return;
  end if;

  -- Sliding 60-second burst guard (6 requests / minute), independent of plan.
  delete from private.ai_rate_events e
  where e.user_id = p_user
    and e.occurred_at <= v_now - interval '60 seconds';

  select count(*)::integer
  into v_minute_used
  from private.ai_rate_events e
  where e.user_id = p_user
    and e.occurred_at > v_now - interval '60 seconds';

  if v_minute_used >= 6 then
    return query select false, 'rate-limit'::text, v_month_used, v_ai_requests;
    return;
  end if;

  insert into private.ai_rate_events (user_id, occurred_at)
  values (p_user, v_now);

  insert into public.ai_usage (user_id, usage_day, tool, requests, chars_used, updated_at)
  values (p_user, v_today, p_tool, 1, p_chars, v_now)
  on conflict (user_id, usage_day, tool)
  do update set requests   = public.ai_usage.requests + 1,
                chars_used = public.ai_usage.chars_used + excluded.chars_used,
                updated_at = excluded.updated_at;

  return query select true, 'ok'::text, v_month_used + 1, v_ai_requests;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security and explicit table grants
-- ---------------------------------------------------------------------------
alter table public.plans          enable row level security;
alter table public.accounts       enable row level security;
alter table public.ai_usage       enable row level security;
alter table private.ai_rate_events enable row level security;

-- Plans are public information (a pricing page needs them). Everything else is
-- service-role only for writes, with own-row read policies for signed-in users.
drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans for select using (true);

drop policy if exists accounts_own_read on public.accounts;
create policy accounts_own_read on public.accounts for select using (auth.uid() = user_id);

drop policy if exists usage_own_read on public.ai_usage;
create policy usage_own_read on public.ai_usage for select using (auth.uid() = user_id);

-- Revoke all table privileges from PUBLIC and browser roles first, then grant
-- only the minimum read access guarded by RLS above.
revoke all on table public.plans from public, anon, authenticated;
revoke all on table public.accounts from public, anon, authenticated;
revoke all on table public.ai_usage from public, anon, authenticated;
revoke all on table private.ai_rate_events from public, anon, authenticated;

grant select on table public.plans to anon, authenticated, service_role;
grant select on table public.accounts to authenticated, service_role;
grant select on table public.ai_usage to authenticated, service_role;
grant all on table public.plans, public.accounts, public.ai_usage to service_role;
grant all on table private.ai_rate_events to service_role;
grant usage, select on all sequences in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Authenticated entry point (binds caller ownership via auth.uid())
-- ---------------------------------------------------------------------------
create or replace function public.consume_own_quota(p_tool text, p_chars integer)
returns table (allowed boolean, reason text, used integer, limit_value integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caller uuid;
begin
  v_caller := auth.uid();
  if v_caller is null then
    return query select false, 'unauthenticated'::text, 0, 0;
    return;
  end if;
  return query select * from private.consume_ai_quota(v_caller, p_tool, p_chars, null);
end;
$$;

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default; revoking
-- from `anon` or `authenticated` alone leaves inherited PUBLIC execution open.
revoke all on function private.consume_ai_quota(uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function private.consume_ai_quota(uuid, text, integer, timestamptz) to service_role;

revoke all on function public.consume_own_quota(text, integer) from public, anon;
grant execute on function public.consume_own_quota(text, integer) to authenticated, service_role;
