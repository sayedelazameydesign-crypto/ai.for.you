import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { validateMigrationSql } from '../scripts/check-sql.mjs'

const migration = readFileSync('supabase/migrations/0001_entitlements.sql', 'utf8')

describe('SQL migration security policy guard', () => {
  it('accepts the hardened entitlements migration with zero policy violations', () => {
    expect(validateMigrationSql(migration, '0001_entitlements.sql')).toEqual([])
  })

  it('rejects SECURITY DEFINER functions that pin a non-empty search_path', () => {
    const mutated = migration.replace("set search_path = ''", 'set search_path = public')
    const rules = validateMigrationSql(mutated, 'mutated.sql').map((r) => r.rule)
    expect(rules).toContain('definer_mutable_search_path')
  })

  it('rejects SECURITY DEFINER functions that omit revoking EXECUTE from PUBLIC', () => {
    const mutated = migration.replace(
      'revoke all on function public.consume_own_quota(text, integer) from public, anon;',
      'revoke execute on function public.consume_own_quota(text, integer) from anon;',
    )
    const rules = validateMigrationSql(mutated, 'mutated.sql').map((r) => r.rule)
    expect(rules).toContain('definer_public_execute_not_revoked')
  })

  it('rejects exposing consume_ai_quota in the public schema or private schema to clients', () => {
    const publicFn = `${migration}\ncreate or replace function public.consume_ai_quota(p_user uuid) returns void language sql security definer set search_path = '' as $$ select; $$;`
    expect(validateMigrationSql(publicFn, 'public-fn.sql').map((r) => r.rule)).toContain('raw_counter_in_public_schema')

    const exposedPrivate = migration.replace(
      'revoke all on schema private from public, anon, authenticated;',
      'revoke all on schema private from anon;',
    )
    expect(validateMigrationSql(exposedPrivate, 'exposed-private.sql').map((r) => r.rule)).toContain('private_schema_exposed')
  })

  it('rejects granting client writes or anon execution of consume_own_quota', () => {
    const clientWrite = `${migration}\ngrant update on table public.accounts to authenticated;`
    expect(validateMigrationSql(clientWrite, 'write.sql').map((r) => r.rule)).toContain('client_can_write')

    const anonExec = `${migration}\ngrant execute on function public.consume_own_quota(text, integer) to anon;`
    expect(validateMigrationSql(anonExec, 'anon-exec.sql').map((r) => r.rule)).toContain('own_quota_callable_by_anon_or_public')
  })
})
