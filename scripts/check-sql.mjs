#!/usr/bin/env node
/**
 * Static assertions for the SQL in supabase/migrations.
 *
 * Complements the live PostgreSQL suite (`npm run test:sql`): fast textual
 * invariants run everywhere in milliseconds so a future edit that weakens
 * `SECURITY DEFINER`, `search_path`, `PUBLIC` execute revocations, or RLS fails
 * immediately even before a database container boots.
 *
 * Usage: node scripts/check-sql.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function validateMigrationSql(sql, file = 'migration.sql') {
  const rules = []
  const fail = (rule, detail) => rules.push({ rule, detail })

  // Comments carry prose, not policy. Stripping them first stops a comment that
  // happens to mention a keyword from being parsed as a statement.
  const lower = sql
    .replace(/--[^\n]*/g, '')
    .toLowerCase()
  const statements = lower.split(';').map((part) => part.trim()).filter(Boolean)

  for (const table of ['public.plans', 'public.accounts', 'public.ai_usage', 'private.ai_rate_events']) {
    const escaped = table.replace('.', '\\.')
    if (!new RegExp(`alter\\s+table\\s+${escaped}\\s+enable\\s+row\\s+level\\s+security`).test(lower)) {
      fail('missing_rls', `${file}: ${table} has no RLS`)
    }
  }

  // Private schema must strip PUBLIC, anon and authenticated usage.
  if (!/revoke\s+all\s+on\s+schema\s+private\s+from\s+public\s*,\s*anon\s*,\s*authenticated\b/.test(lower)) {
    fail('private_schema_exposed', `${file}: schema private must revoke all from public, anon, authenticated`)
  }

  // A usage or account write granted to PUBLIC or a browser role is a self-serve quota increase.
  for (const statement of statements) {
    if (!/^grant\b/.test(statement)) continue
    const grantsWrite = /\b(?:insert|update|delete|truncate)\b/.test(statement) || /^grant\s+all\b/.test(statement)
    if (grantsWrite && /\b(?:public|anon|authenticated)\b/.test(statement) && !/\bto\s+service_role\s*$/.test(statement)) {
      // Check the `to ...` clause specifically so `on table public.plans to service_role` is not confused with role `public`.
      const toClause = /\bto\s+([^;]+)$/.exec(statement)?.[1] ?? ''
      if (/\b(?:public|anon|authenticated)\b/.test(toClause)) {
        fail('client_can_write', `${file}: ${statement.slice(0, 80)}`)
      }
    }
    if (/^grant\s+execute\b/.test(statement)) {
      const toClause = /\bto\s+([^;]+)$/.exec(statement)?.[1] ?? ''
      if (/\bon\s+function\s+private\./.test(statement) && /\b(?:public|anon|authenticated)\b/.test(toClause)) {
        fail('private_function_callable_by_client', `${file}: ${statement.slice(0, 80)}`)
      }
      if (/\bon\s+function\s+public\.consume_own_quota\b/.test(statement) && /\b(?:public|anon)\b/.test(toClause)) {
        fail('own_quota_callable_by_anon_or_public', `${file}: ${statement.slice(0, 80)}`)
      }
    }
  }

  // Every privileged function must pin an empty search_path (`set search_path = ''`)
  // and explicitly revoke default PUBLIC execution.
  const definerHeaders = [
    ...lower.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([a-z0-9_.]+)\s*\(([^)]*)\)([\s\S]*?)\bas\s+\$\$/g),
  ]
  if (!definerHeaders.length) {
    fail('missing_definer_functions', `${file}: expected security definer quota functions`)
  }
  for (const [, fnName, rawArgs, attrs] of definerHeaders) {
    if (!/\bsecurity\s+definer\b/.test(attrs)) continue
    if (!/\bset\s+search_path\s*=\s*''/.test(attrs)) {
      fail('definer_mutable_search_path', `${file}: ${fnName} must use set search_path = ''`)
    }
    const revokeRe = new RegExp(`revoke\\s+(?:all|execute)\\s+on\\s+function\\s+${fnName.replace('.', '\\.')}\\s*\\([^)]*\\)\\s+from\\s+([^;]+)`)
    const revokeMatch = revokeRe.exec(lower)
    if (!revokeMatch || !/\bpublic\b/.test(revokeMatch[1])) {
      fail('definer_public_execute_not_revoked', `${file}: ${fnName}(${rawArgs.trim()}) must revoke execute from PUBLIC`)
    }
  }

  // Raw per-user counter must never live in `public`.
  if (/create\s+(?:or\s+replace\s+)?function\s+public\.consume_ai_quota\b/.test(lower)) {
    fail('raw_counter_in_public_schema', `${file}: consume_ai_quota must live in private schema`)
  }

  // Hard-coded secrets in SQL are a leak that secret scanning may not catch.
  if (/gsk_[a-z0-9]{20,}/i.test(sql) || /service_role[_-]?key\s*=\s*['"]/.test(lower)) {
    fail('secret_in_migration', `${file}`)
  }

  return rules
}

function main() {
  const dir = 'supabase/migrations'
  const files = readdirSync(dir).filter((name) => name.endsWith('.sql'))
  if (!files.length) {
    console.error('sql_check=failed reason=no_migrations')
    process.exit(1)
  }

  const rules = []
  for (const file of files) {
    const sql = readFileSync(`${dir}/${file}`, 'utf8')
    rules.push(...validateMigrationSql(sql, file))
  }

  if (rules.length) {
    console.error('sql_check=failed')
    for (const { rule, detail } of rules) console.error(`::error title=SQL policy::${rule} - ${detail}`)
    process.exit(1)
  }
  console.log(`sql_check=passed files=${files.length}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main()
}
