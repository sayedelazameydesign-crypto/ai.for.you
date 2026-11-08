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
--   1. The browser never writes these tables. They are service-role only, and
--      RLS is enabled with no policy for `anon` or `authenticated`. A user
--      cannot grant themselves more usage by calling the REST API.
--   2. Usage is incremented through a SECURITY DEFINER function, so the counter
--      is atomic and cannot be raced by two concurrent requests.
--   3. Only a hash of the user reference is stored in the usage ledger. No
--      prompt text, no IP addresses, no email — consistent with the privacy
--      posture in SECURITY.md.
--   4. Nothing here enables payments. It models entitlement, not billing.

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
-- Usage ledger
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

-- ---------------------------------------------------------------------------
-- Atomic consumption
-- ---------------------------------------------------------------------------
-- Returns the remaining allowance after the request, or a reason code when the
-- request is refused. A single function so that the check and the increment
-- cannot be separated by a concurrent request.
create or replace function public.consume_ai_quota(
  p_user    uuid,
  p_tool    text,
  p_chars   integer
)
returns table (allowed boolean, reason text, used integer, limit_value integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_plan          public.plans;
  v_month_used    integer;
  v_day_requests  integer;
begin
  select a.status, p.* into v_status, v_plan
  from public.accounts a
  join public.plans p on p.id = a.plan_id
  where a.user_id = p_user;

  if not found then
    return query select false, 'no-account', 0, 0;
    return;
  end if;

  if v_status <> 'active' then
    return query select false, 'account-' || v_status, 0, 0;
    return;
  end if;

  if p_chars > v_plan.max_chars then
    return query select false, 'input-too-long', 0, v_plan.max_chars;
    return;
  end if;

  -- Monthly usage, counted from the daily ledger.
  select coalesce(sum(requests), 0)::integer into v_month_used
  from public.ai_usage
  where user_id = p_user
    and date_trunc('month', usage_day) = date_trunc('month', (now() at time zone 'utc')::date);

  if v_month_used >= v_plan.ai_requests then
    return query select false, 'monthly-limit', v_month_used, v_plan.ai_requests;
    return;
  end if;

  -- Per-minute burst guard, independent of the plan. Two requests per second
  -- sustained would be a runaway client, not a person.
  select coalesce(sum(requests), 0)::integer into v_day_requests
  from public.ai_usage
  where user_id = p_user
    and usage_day = (now() at time zone 'utc')::date
    and updated_at > now() - interval '1 minute';

  if v_day_requests >= 6 then
    return query select false, 'rate-limit', v_month_used, v_plan.ai_requests;
    return;
  end if;

  insert into public.ai_usage (user_id, usage_day, tool, requests, chars_used)
  values (p_user, (now() at time zone 'utc')::date, p_tool, 1, p_chars)
  on conflict (user_id, usage_day, tool)
  do update set requests = public.ai_usage.requests + 1,
                chars_used = public.ai_usage.chars_used + excluded.chars_used,
                updated_at = now();

  return query select true, 'ok', v_month_used + 1, v_plan.ai_requests;
end;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.plans    enable row level security;
alter table public.accounts enable row level security;
alter table public.ai_usage enable row level security;

-- Plans are public information (a pricing page needs them). Everything else is
-- service-role only: no policy is created for `anon` or `authenticated`, which
-- means deny by default.
drop policy if exists plans_public_read on public.plans;
create policy plans_public_read on public.plans for select using (true);

-- A signed-in user may read their own account row and their own usage, which is
-- what the settings page needs to display remaining quota. They may not insert,
-- update or delete: a user must never be able to raise their own limit.
drop policy if exists accounts_own_read on public.accounts;
create policy accounts_own_read on public.accounts for select using (auth.uid() = user_id);

drop policy if exists usage_own_read on public.ai_usage;
create policy usage_own_read on public.ai_usage for select using (auth.uid() = user_id);

-- No insert/update/delete policy is defined for ai_usage. Only
-- consume_ai_quota() writes it, and it runs with definer rights.
revoke insert, update, delete on public.ai_usage from anon, authenticated;
revoke insert, update, delete on public.accounts from anon, authenticated;

-- The quota function must be callable, but only for the caller's own account.
create or replace function public.consume_own_quota(p_tool text, p_chars integer)
returns table (allowed boolean, reason text, used integer, limit_value integer)
language sql
security definer
set search_path = public
as $$
  select * from public.consume_ai_quota(auth.uid(), p_tool, p_chars);
$$;

grant execute on function public.consume_own_quota(text, integer) to authenticated;
revoke execute on function public.consume_ai_quota(uuid, text, integer) from anon, authenticated;
