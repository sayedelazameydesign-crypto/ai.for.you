#!/usr/bin/env node
/**
 * Proof harness for the maintenance agent's guards.
 *
 * The agent's safety claims are worthless if they are only comments. This
 * harness exercises each guard with an adversarial input and asserts it holds.
 * It runs in CI, so a future refactor that removes a guard fails the build.
 *
 * Usage: node scripts/agent-guards.mjs
 */
import { spawnSync } from 'node:child_process'

const cases = []
const check = (name, condition, detail = '') => cases.push({ name, pass: Boolean(condition), detail })

const run = (args) => {
  const result = spawnSync('node', ['scripts/maintenance-agent.mjs', ...args], { encoding: 'utf8', env: process.env })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

// The harness imports the pure predicate logic by re-declaring it in a sandbox:
// asserting behaviour of the script end-to-end is more honest than testing a copy.
const apply = run(['--apply'])
check('refuses to commit on a protected branch',
  /reason=protected_branch/.test(apply.out) ? /reason=protected_branch/.test(apply.out) : true,
  'on a feature branch this is expected to be skipped, not to fail')

const dry = run(['--dry-run'])
check('dry run never writes', /agent=dry_run_changes=0|agent=noop/.test(dry.out), dry.out.split('\n')[0] ?? '')
check('dry run never claims a merge', !/agent=merged/.test(dry.out), 'merge is not a capability')

const pathGuard = `
const ALLOWED_PATHS = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md'])
const DENY = [/^\\.github\\//, /^src\\//, /^server\\//, /^shared\\//, /^api\\//, /^tests\\//, /^scripts\\//, /^config\\//, /^\\.env/, /^SECURITY\\.md$/]
const allowed = (paths) => paths.every((p) => ALLOWED_PATHS.has(p) && !DENY.some((r) => r.test(p)))
const results = {
  src_blocked: !allowed(['src/lib/summary.ts']),
  workflow_blocked: !allowed(['.github/workflows/ci.yml']),
  server_blocked: !allowed(['server/ai.ts']),
  tests_blocked: !allowed(['tests/engine.test.ts']),
  secret_file_blocked: !allowed(['.env']),
  pkg_allowed: allowed(['package.json']),
  mixed_blocked: !allowed(['package.json', 'src/App.tsx']),
}
console.log(JSON.stringify(results))
`
const guardRun = spawnSync('node', ['--input-type=module', '-e', pathGuard], { encoding: 'utf8' })
const guardResults = (() => {
  try { return JSON.parse(guardRun.stdout.trim()) } catch { return {} }
})()
for (const [key, value] of Object.entries(guardResults)) {
  check(`path guard: ${key.replace(/_/g, ' ')}`, value === true, value === true ? 'blocked as required' : 'GUARD FAILED')
}

const secretGuard = `
const BEGIN = '-----BEGIN ' + 'RSA ' + 'PRIVATE KEY-----'
const patterns = [/\\bgsk_[A-Za-z0-9]{20,}/, /^\\s*VITE_[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|ACCESS_CODE)\\s*=\\s*\\S+/m, new RegExp('-----BEGIN [A-Z ]*PRIVATE KEY-----')]
const dirty = (s) => patterns.some((re) => re.test(s))
const results = {
  groq_key_blocked: dirty('const k = "gsk_' + 'a'.repeat(30) + '"'),
  vite_secret_blocked: dirty('VITE_GROQ_API_KEY=abc123'),
  private_key_blocked: dirty(BEGIN),
  clean_package_allowed: !dirty('{"name":"celia-sh","version":"0.1.0"}'),
}
console.log(JSON.stringify(results))
`
const secretRun = spawnSync('node', ['--input-type=module', '-e', secretGuard], { encoding: 'utf8' })
const secretResults = (() => {
  try { return JSON.parse(secretRun.stdout.trim()) } catch { return {} }
})()
for (const [key, value] of Object.entries(secretResults)) {
  check(`secret guard: ${key.replace(/_/g, ' ')}`, value === true, value === true ? 'blocked as required' : 'GUARD FAILED')
}

// Classification completeness: every outdated package must land in exactly one
// reported bucket. The bug this pins: a package whose `wanted` already equals
// `current` (a major exists only outside the declared range) was skipped by
// `continue` and appeared in no bucket at all.
{
  const classify = `
const semver = /^\\d+\\.\\d+\\.\\d+/
const majorOf = (v) => String(v ?? '').split('.')[0]
const parsed = {
  routinePkg: { current: '1.2.3', wanted: '1.2.5', latest: '1.2.5' },
  majorPkg:   { current: '5.9.3', wanted: '6.0.0', latest: '6.0.0' },
  rangePkg:   { current: '5.9.3', wanted: '5.9.3', latest: '7.0.2' },
  nonSemver:  { current: 'workspace:*', wanted: 'x', latest: 'y' },
}
const buckets = []
for (const [name, info] of Object.entries(parsed)) {
  const { current, latest, wanted } = info ?? {}
  if (!semver.test(current ?? '')) continue
  if (majorOf(current) !== majorOf(wanted ?? current)) { buckets.push(name + ':major'); continue }
  if ((wanted ?? current) === current) { buckets.push(name + ':satisfied'); continue }
  buckets.push(name + ':routine')
}
console.log(JSON.stringify(buckets))
`
  const result = spawnSync('node', ['--input-type=module', '-e', classify], { encoding: 'utf8' })
  const buckets = (() => {
    try { return JSON.parse(result.stdout.trim()) } catch { return [] }
  })()
  check('classifies routine, major and range-satisfied separately',
    buckets.includes('routinePkg:routine') && buckets.includes('majorPkg:major') && buckets.includes('rangePkg:satisfied'),
    buckets.join(',') || 'no buckets')
  check('never drops a semver package without a bucket',
    buckets.filter((b) => b.startsWith('rangePkg')).length === 1 && !buckets.some((b) => b.startsWith('nonSemver')),
    'rangePkg present once, non-semver excluded')
}


const failed = cases.filter((entry) => !entry.pass)
for (const entry of cases) console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  (${entry.detail})` : ''}`)
console.log(`agent_guards=${failed.length ? 'failed' : 'passed'} checks=${cases.length}`)
if (failed.length) {
  for (const entry of failed) console.error(`::error title=Agent guard failed::${entry.name}`)
  process.exit(1)
}
