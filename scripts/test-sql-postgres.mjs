#!/usr/bin/env node
/**
 * Live PostgreSQL behavioural, privilege and concurrency suite for
 * `supabase/migrations/0001_entitlements.sql`.
 *
 * Honesty rule (same as docs/EVIDENCE.md):
 *   - When `DATABASE_URL` is absent and `--require-db` is NOT passed, this
 *     script reports `sql_live=not_run` and never claims a pass.
 *   - In CI (`--require-db`), a missing or unreachable database fails the job.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/test-sql-postgres.mjs --require-db
 */
import { readFileSync } from 'node:fs'
import pg from 'pg'

const { Pool } = pg
const REQUIRE_DB = process.argv.includes('--require-db')
const DATABASE_URL = process.env.DATABASE_URL?.trim() ?? ''

if (!DATABASE_URL) {
  if (REQUIRE_DB) {
    console.error('sql_live=failed reason=missing_database_url')
    process.exit(1)
  }
  console.log('sql_live=not_run reason=no_database_url')
  process.exit(0)
}

const cases = []
function assertCase(name, condition, detail = '') {
  cases.push({ name, pass: Boolean(condition), detail })
  if (!condition) throw new Error(`Assertion failed: ${name}${detail ? ` (${detail})` : ''}`)
}

async function expectPgError(fn, expectedCode, label) {
  try {
    await fn()
    assertCase(label, false, `expected PostgreSQL error ${expectedCode}, but query succeeded`)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown'
    assertCase(label, code === expectedCode, `code=${code}`)
  }
}

async function runAsRole(pool, role, jwtSub, queryText, params = []) {
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`set local role ${role}`)
    if (jwtSub) {
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [jwtSub])
      await client.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: jwtSub, role })])
    } else {
      await client.query(`select set_config('request.jwt.claim.sub', '', true)`)
      await client.query(`select set_config('request.jwt.claims', '', true)`)
    }
    const res = await client.query(queryText, params)
    await client.query('commit')
    return res
  } catch (error) {
    await client.query('rollback').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

const BOOTSTRAP_SQL = `
drop schema if exists private cascade;
drop table if exists public.ai_usage cascade;
drop table if exists public.accounts cascade;
drop table if exists public.plans cascade;
drop schema if exists auth cascade;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin nosuperuser nocreatedb nocreaterole bypassrls;
  end if;
end
$$;

grant anon, authenticated, service_role to current_user;

create schema auth;
grant usage on schema auth to public, anon, authenticated, service_role;

create table auth.users (
  id uuid primary key
);

create or replace function auth.uid()
returns uuid
language sql
stable
as $fn$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$fn$;

grant execute on function auth.uid() to public, anon, authenticated, service_role;

-- Pre-create the legacy public function to prove the migration drops it.
create or replace function public.consume_ai_quota(p_user uuid, p_tool text, p_chars integer)
returns table (allowed boolean, reason text, used integer, limit_value integer)
language sql
as $legacy$
  select true, 'legacy'::text, 0, 0;
$legacy$;
`

const USER_A          = '00000000-0000-4000-8000-000000000001'
const USER_B          = '00000000-0000-4000-8000-000000000002'
const USER_BLOCKED    = '00000000-0000-4000-8000-000000000003'
const USER_SLIDING    = '00000000-0000-4000-8000-000000000004'
const USER_BURST_RACE = '00000000-0000-4000-8000-000000000005'
const USER_MONTH_RACE = '00000000-0000-4000-8000-000000000006'
const USER_CROSS_1    = '00000000-0000-4000-8000-000000000007'
const USER_CROSS_2    = '00000000-0000-4000-8000-000000000008'
const USER_MISSING    = '00000000-0000-4000-8000-000000000099'

const pool = new Pool({ connectionString: DATABASE_URL, max: 20 })

try {
  const migrationSql = readFileSync('supabase/migrations/0001_entitlements.sql', 'utf8')
  await pool.query(BOOTSTRAP_SQL)
  // Run twice to prove idempotence.
  await pool.query(migrationSql)
  await pool.query(migrationSql)
  assertCase('migration applies idempotently twice', true)

  /* 1. Metadata: SECURITY DEFINER, search_path = '', PUBLIC revocations ---- */

  const legacy = await pool.query(`
    select count(*)::int as cnt
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'consume_ai_quota'
  `)
  assertCase('legacy public.consume_ai_quota is absent', legacy.rows[0].cnt === 0, `cnt=${legacy.rows[0].cnt}`)

  const procs = await pool.query(`
    select n.nspname as schema, p.proname as name, p.prosecdef as secdef, coalesce(p.proconfig, '{}') as config
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'private' and p.proname = 'consume_ai_quota')
       or (n.nspname = 'public'  and p.proname = 'consume_own_quota')
    order by n.nspname
  `)
  assertCase('both quota functions exist as SECURITY DEFINER with empty search_path',
    procs.rows.length === 2 && procs.rows.every((r) => r.secdef === true && r.config.some((c) => c === 'search_path=""' || c === 'search_path=')),
    JSON.stringify(procs.rows))

  const acl = await pool.query(`
    select
      has_function_privilege('public',        'private.consume_ai_quota(uuid,text,integer,timestamptz)', 'EXECUTE') as pub_raw,
      has_function_privilege('anon',          'private.consume_ai_quota(uuid,text,integer,timestamptz)', 'EXECUTE') as anon_raw,
      has_function_privilege('authenticated', 'private.consume_ai_quota(uuid,text,integer,timestamptz)', 'EXECUTE') as auth_raw,
      has_function_privilege('service_role',  'private.consume_ai_quota(uuid,text,integer,timestamptz)', 'EXECUTE') as svc_raw,
      has_function_privilege('public',        'public.consume_own_quota(text,integer)',                  'EXECUTE') as pub_own,
      has_function_privilege('anon',          'public.consume_own_quota(text,integer)',                  'EXECUTE') as anon_own,
      has_function_privilege('authenticated', 'public.consume_own_quota(text,integer)',                  'EXECUTE') as auth_own,
      has_schema_privilege('anon',            'private',                                                 'USAGE')   as anon_priv_schema,
      has_schema_privilege('authenticated',   'private',                                                 'USAGE')   as auth_priv_schema
  `)
  const p = acl.rows[0]
  assertCase('PUBLIC and client roles cannot execute private.consume_ai_quota', !p.pub_raw && !p.anon_raw && !p.auth_raw && p.svc_raw, JSON.stringify(p))
  assertCase('PUBLIC and anon cannot execute public.consume_own_quota while authenticated can', !p.pub_own && !p.anon_own && p.auth_own, JSON.stringify(p))
  assertCase('private schema usage is revoked from anon and authenticated', !p.anon_priv_schema && !p.auth_priv_schema)

  /* 2. Seed test accounts -------------------------------------------------- */

  for (const id of [USER_A, USER_B, USER_BLOCKED, USER_SLIDING, USER_BURST_RACE, USER_MONTH_RACE, USER_CROSS_1, USER_CROSS_2]) {
    await pool.query('insert into auth.users (id) values ($1)', [id])
  }
  await pool.query(`
    insert into public.accounts (user_id, plan_id, status) values
      ($1, 'free', 'active'),
      ($2, 'free', 'active'),
      ($3, 'free', 'blocked'),
      ($4, 'pro',  'active'),
      ($5, 'pro',  'active'),
      ($6, 'free', 'active'),
      ($7, 'free', 'active'),
      ($8, 'free', 'active')
  `, [USER_A, USER_B, USER_BLOCKED, USER_SLIDING, USER_BURST_RACE, USER_MONTH_RACE, USER_CROSS_1, USER_CROSS_2])

  /* 3. Live role & ownership isolation ------------------------------------- */

  const anonPlans = await runAsRole(pool, 'anon', null, 'select id from public.plans order by id')
  assertCase('anon can read public pricing plans', anonPlans.rows.map((r) => r.id).join(',') === 'free,pro')

  await expectPgError(() => runAsRole(pool, 'anon', null, 'select * from public.accounts'), '42501', 'anon cannot read accounts')
  await expectPgError(() => runAsRole(pool, 'anon', null, 'select * from public.ai_usage'), '42501', 'anon cannot read ai_usage')
  await expectPgError(() => runAsRole(pool, 'anon', null, `insert into public.plans (id, label_ar, monthly_cents, ai_requests, max_chars) values ('hack', 'x', 0, 9999, 12000)`), '42501', 'anon cannot insert plans')
  await expectPgError(() => runAsRole(pool, 'anon', null, `select * from public.consume_own_quota('marketing', 100)`), '42501', 'anon cannot call consume_own_quota')
  await expectPgError(() => runAsRole(pool, 'anon', null, `select * from private.consume_ai_quota($1, 'marketing', 100, null)`, [USER_A]), '42501', 'anon cannot access private.consume_ai_quota')

  const noJwt = await runAsRole(pool, 'authenticated', null, `select * from public.consume_own_quota('marketing', 100)`)
  assertCase('authenticated without auth.uid() is rejected cleanly', noJwt.rows[0].allowed === false && noJwt.rows[0].reason === 'unauthenticated')

  await expectPgError(
    () => runAsRole(pool, 'authenticated', USER_A, `select * from private.consume_ai_quota($1, 'marketing', 100, null)`, [USER_B]),
    '42501',
    'authenticated User A cannot call private.consume_ai_quota for User B',
  )
  await expectPgError(
    () => runAsRole(pool, 'authenticated', USER_A, `update public.accounts set plan_id = 'pro' where user_id = $1`, [USER_A]),
    '42501',
    'authenticated user cannot self-upgrade plan',
  )
  await expectPgError(
    () => runAsRole(pool, 'authenticated', USER_A, `delete from public.ai_usage where user_id = $1`, [USER_A]),
    '42501',
    'authenticated user cannot erase ai_usage',
  )

  const ownCall = await runAsRole(pool, 'authenticated', USER_A, `select * from public.consume_own_quota('marketing', 320)`)
  assertCase('authenticated User A consumes own quota via consume_own_quota',
    ownCall.rows[0].allowed === true && ownCall.rows[0].used === 1 && ownCall.rows[0].limit_value === 20)

  const visibleAccounts = await runAsRole(pool, 'authenticated', USER_A, `select user_id from public.accounts`)
  assertCase('RLS restricts accounts select to own user_id only',
    visibleAccounts.rows.length === 1 && visibleAccounts.rows[0].user_id === USER_A)

  const userBUsage = await pool.query('select coalesce(sum(requests), 0)::int as used from public.ai_usage where user_id = $1', [USER_B])
  assertCase('User B quota remains untouched', userBUsage.rows[0].used === 0)

  /* 4. Input & status guards ----------------------------------------------- */

  const missingAcc = await pool.query(`select * from private.consume_ai_quota($1, 'marketing', 100, null)`, [USER_MISSING])
  assertCase('missing account returns no-account', missingAcc.rows[0].allowed === false && missingAcc.rows[0].reason === 'no-account')

  const blockedAcc = await runAsRole(pool, 'authenticated', USER_BLOCKED, `select * from public.consume_own_quota('marketing', 100)`)
  assertCase('blocked account returns account-blocked', blockedAcc.rows[0].allowed === false && blockedAcc.rows[0].reason === 'account-blocked')

  const badTool = await runAsRole(pool, 'authenticated', USER_B, `select * from public.consume_own_quota('unknown', 100)`)
  assertCase('invalid tool is rejected without burning quota', badTool.rows[0].allowed === false && badTool.rows[0].reason === 'invalid-tool')

  const negChars = await runAsRole(pool, 'authenticated', USER_B, `select * from public.consume_own_quota('marketing', -1)`)
  assertCase('negative char count is rejected', negChars.rows[0].allowed === false && negChars.rows[0].reason === 'invalid-input')

  const tooLong = await runAsRole(pool, 'authenticated', USER_B, `select * from public.consume_own_quota('marketing', 12001)`)
  assertCase('input exceeding max_chars is rejected without burning quota',
    tooLong.rows[0].allowed === false && tooLong.rows[0].reason === 'input-too-long' && tooLong.rows[0].limit_value === 12000)

  /* 5. True sliding 60-second window (fixes daily-rollup false lockouts) --- */

  // 10 earlier requests on the SAME UTC day (hours earlier): must NOT poison a later minute.
  for (let i = 0; i < 5; i++) {
    const r = await pool.query(`select * from private.consume_ai_quota($1, 'marketing', 200, '2026-11-09T09:00:00Z'::timestamptz + ($2 || ' seconds')::interval)`, [USER_SLIDING, String(i)])
    assertCase(`morning batch 1 #${i + 1} succeeds`, r.rows[0].allowed === true)
  }
  for (let i = 0; i < 5; i++) {
    const r = await pool.query(`select * from private.consume_ai_quota($1, 'summary', 200, '2026-11-09T09:10:00Z'::timestamptz + ($2 || ' seconds')::interval)`, [USER_SLIDING, String(i)])
    assertCase(`morning batch 2 #${i + 1} succeeds`, r.rows[0].allowed === true)
  }

  // At 17:00:00Z (same UTC day, 10 requests already in ai_usage):
  // 3 requests at +0s and 3 requests at +40s must all succeed (used = 11..16).
  for (let i = 0; i < 3; i++) {
    const r = await pool.query(`select * from private.consume_ai_quota($1, 'marketing', 200, '2026-11-09T17:00:00Z'::timestamptz)`, [USER_SLIDING])
    assertCase(`sliding window t+0s slot ${i + 1} allowed despite 10 earlier same-day requests`, r.rows[0].allowed === true && r.rows[0].used === 11 + i)
  }
  for (let i = 0; i < 3; i++) {
    const r = await pool.query(`select * from private.consume_ai_quota($1, 'code', 200, '2026-11-09T17:00:40Z'::timestamptz)`, [USER_SLIDING])
    assertCase(`sliding window t+40s slot ${i + 4} allowed`, r.rows[0].allowed === true && r.rows[0].used === 14 + i)
  }

  const seventhAt50s = await pool.query(`select * from private.consume_ai_quota($1, 'marketing', 200, '2026-11-09T17:00:50Z'::timestamptz)`, [USER_SLIDING])
  assertCase('7th request within 60s window is rate-limited',
    seventhAt50s.rows[0].allowed === false && seventhAt50s.rows[0].reason === 'rate-limit' && seventhAt50s.rows[0].used === 16)

  // At 17:01:01Z (+61s): the 3 events from 17:00:00Z expired, while the 3 from 17:00:40Z remain (21s old).
  // Exactly 3 new requests must pass, and the 4th must hit rate-limit.
  for (let i = 0; i < 3; i++) {
    const r = await pool.query(`select * from private.consume_ai_quota($1, 'marketing', 200, '2026-11-09T17:01:01Z'::timestamptz)`, [USER_SLIDING])
    assertCase(`sliding window t+61s freed slot ${i + 1} succeeds`, r.rows[0].allowed === true && r.rows[0].used === 17 + i)
  }
  const fourthAt61s = await pool.query(`select * from private.consume_ai_quota($1, 'marketing', 200, '2026-11-09T17:01:01Z'::timestamptz)`, [USER_SLIDING])
  assertCase('4th request at t+61s hits rate-limit because t+40s events are still inside 60s',
    fourthAt61s.rows[0].allowed === false && fourthAt61s.rows[0].reason === 'rate-limit' && fourthAt61s.rows[0].used === 19)

  const activeEvents = await pool.query('select count(*)::int as cnt from private.ai_rate_events where user_id = $1', [USER_SLIDING])
  assertCase('expired rate events are pruned to at most 6 per account', activeEvents.rows[0].cnt === 6, `cnt=${activeEvents.rows[0].cnt}`)

  /* 6. Concurrency: 12 simultaneous authenticated requests -> exactly 6 ok -- */

  const burstClients = await Promise.all(Array.from({ length: 12 }, () => pool.connect()))
  try {
    await Promise.all(burstClients.map(async (client) => {
      await client.query('begin')
      await client.query('set local role authenticated')
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [USER_BURST_RACE])
    }))
    let releaseBarrier
    const barrier = new Promise((resolve) => { releaseBarrier = resolve })
    const tasks = burstClients.map(async (client) => {
      await barrier
      const res = await client.query(`select * from public.consume_own_quota('marketing', 400)`)
      await client.query('commit')
      return res.rows[0]
    })
    releaseBarrier()
    const outcomes = await Promise.all(tasks)
    const allowedRows = outcomes.filter((r) => r.allowed === true)
    const deniedRows = outcomes.filter((r) => r.allowed === false)
    const usedSeq = allowedRows.map((r) => r.used).sort((a, b) => a - b)

    assertCase('12 concurrent requests allow exactly 6',
      allowedRows.length === 6 && usedSeq.join(',') === '1,2,3,4,5,6',
      `allowed=${allowedRows.length} used=${usedSeq.join(',')}`)
    assertCase('12 concurrent requests reject the remaining 6 with rate-limit',
      deniedRows.length === 6 && deniedRows.every((r) => r.reason === 'rate-limit'),
      `denied=${deniedRows.length}`)

    const ledger = await pool.query('select requests, chars_used::text as chars from public.ai_usage where user_id = $1', [USER_BURST_RACE])
    assertCase('concurrent ledger totals match the 6 accepted requests',
      ledger.rows.length === 1 && ledger.rows[0].requests === 6 && ledger.rows[0].chars === '2400',
      JSON.stringify(ledger.rows[0]))
  } finally {
    for (const client of burstClients) {
      await client.query('rollback').catch(() => {})
      client.release()
    }
  }

  /* 7. Concurrency: monthly limit race + cross-account non-contention ------ */

  // Seed 18 prior requests on the current UTC day (updated 10 minutes ago so the
  // 60-second sliding burst window is empty while monthly usage stands at 18/20).
  await pool.query(
    `insert into public.ai_usage (user_id, usage_day, tool, requests, chars_used, updated_at)
     values ($1, (clock_timestamp() at time zone 'utc')::date, 'summary', 18, 1800, clock_timestamp() - interval '10 minutes')`,
    [USER_MONTH_RACE],
  )
  const monthResults = await Promise.all(
    Array.from({ length: 8 }, () => runAsRole(pool, 'authenticated', USER_MONTH_RACE, `select * from public.consume_own_quota('summary', 250)`)),
  )
  const monthRows = monthResults.map((r) => r.rows[0])
  const monthAllowed = monthRows.filter((r) => r.allowed === true).map((r) => r.used).sort((a, b) => a - b)
  const monthDenied = monthRows.filter((r) => r.allowed === false)
  assertCase('8 concurrent requests at 18/20 monthly usage allow only 19 and 20',
    monthAllowed.join(',') === '19,20' && monthDenied.length === 6 && monthDenied.every((r) => r.reason === 'monthly-limit' && r.used === 20),
    `allowed=${monthAllowed.join(',')} denied=${monthDenied.length}`)

  const crossResults = await Promise.all([
    ...Array.from({ length: 6 }, () => runAsRole(pool, 'authenticated', USER_CROSS_1, `select * from public.consume_own_quota('code', 150)`)),
    ...Array.from({ length: 6 }, () => runAsRole(pool, 'authenticated', USER_CROSS_2, `select * from public.consume_own_quota('code', 150)`)),
  ])
  assertCase('concurrent requests across distinct accounts on the same plan all succeed without cross-blocking',
    crossResults.every((r) => r.rows[0].allowed === true))

  console.log(`sql_live=passed checks=${cases.length}`)
} catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  for (const c of cases) {
    if (!c.pass) console.error(`FAIL  ${c.name}${c.detail ? ` (${c.detail})` : ''}`)
  }
  console.error(`::error title=SQL Live::${message}`)
  console.error(`sql_live=failed error=${message}`)
  process.exit(1)
} finally {
  await pool.end().catch(() => {})
}
