#!/usr/bin/env node
/**
 * Static assertions for the SQL in supabase/migrations.
 *
 * There is no Postgres in CI, so the migration cannot be executed here. That is
 * exactly why the security-relevant properties are asserted textually: a future
 * edit that removes RLS or grants a write to `authenticated` must fail the
 * build, not be discovered after a deploy.
 *
 * Usage: node scripts/check-sql.mjs
 */
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'

const DIR = 'supabase/migrations'
const files = readdirSync(DIR).filter((name) => name.endsWith('.sql'))
if (!files.length) {
  console.error('sql_check=failed reason=no_migrations')
  process.exit(1)
}

const rules = []
const fail = (rule, detail) => rules.push({ rule, detail })

for (const file of files) {
  const sql = readFileSync(`${DIR}/${file}`, 'utf8')
  // Comments carry prose, not policy. Stripping them first stops a comment that
  // happens to mention a keyword from being parsed as a statement.
  const lower = sql
    .replace(/--[^\n]*/g, '')
    .toLowerCase()
  const statements = lower.split(';').map((part) => part.trim()).filter(Boolean)

  for (const table of ['plans', 'accounts', 'ai_usage']) {
    if (!new RegExp(`alter table public\\.${table}\\s+enable row level security`).test(lower)) {
      fail('missing_rls', `${file}: ${table} has no RLS`)
    }
  }

  // A usage or account write granted to a browser role is a self-serve quota increase.
  for (const statement of statements) {
    const writes = /^(grant|revoke)\b/.test(statement)
    if (!writes) continue
    const grantsWrite = /\binsert\b|\bupdate\b|\bdelete\b/.test(statement) && !/revoke/.test(statement)
    if (grantsWrite && /\b(anon|authenticated)\b/.test(statement)) {
      fail('client_can_write', `${file}: ${statement.slice(0, 80)}`)
    }
  }

  // Every privileged function must pin its search_path, or it is hijackable.
  const definers = statements.filter((s) => s.includes('security definer'))
  for (const definer of definers) {
    if (!/set search_path/.test(definer)) fail('definer_without_search_path', `${file}: ${definer.slice(0, 60)}`)
  }

  // The browser must not be able to call the raw counter with someone else's id.
  if (/grant execute on function public\.consume_ai_quota\([^)]*\) to (anon|authenticated)/.test(lower)) {
    fail('raw_counter_callable_by_client', `${file}`)
  }

  // Hard-coded secrets in SQL are a leak that secret scanning may not catch.
  if (/gsk_[a-z0-9]{20,}/i.test(sql) || /service_role[_-]?key\s*=\s*['"]/.test(lower)) {
    fail('secret_in_migration', `${file}`)
  }
}

if (rules.length) {
  console.error('sql_check=failed')
  for (const { rule, detail } of rules) console.error(`::error title=SQL policy::${rule} - ${detail}`)
  process.exit(1)
}
console.log(`sql_check=passed files=${files.length}`)
