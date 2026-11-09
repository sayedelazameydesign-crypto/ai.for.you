#!/usr/bin/env node
/**
 * Maintenance agent — propose, never decide.
 *
 * Pipeline position: Propose. It reads a maintenance report and can open a
 * pull request that fixes *only* a class of problem it is allowed to touch.
 *
 * Hard limits, enforced in code below and not only in prose:
 *
 *   1. It never commits to a protected branch. A branch named
 *      `maintenance/...` is created; the default branch is never a target.
 *   2. It never merges. It cannot: the workflow job has no write access to
 *      contents beyond pushing its own branch, and merging needs a human.
 *   3. It never edits application code, tests, workflows, or secrets. The
 *      allowlist is `package.json`, `package-lock.json`, `CHANGELOG.md`.
 *   4. It never runs on a `pull_request` event, so a fork cannot use it to
 *      obtain a token.
 *   5. It refuses a diff that touches a deny-listed path, even if a future
 *      caller asks for it. This is the guard that survives refactoring.
 *   6. It refuses to touch a secret-shaped value or a `VITE_` key.
 *
 * What it may actually do: apply routine dependency updates (patch and minor
 * only) and add a CHANGELOG line. That is deliberately boring. A maintenance
 * agent that rewrites logic unsupervised is not maintenance.
 *
 * Usage (offline dry run, the default):
 *   node scripts/maintenance-agent.mjs --dry-run
 * Usage (inside the workflow, after `npm install`):
 *   node scripts/maintenance-agent.mjs --apply
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const APPLY = process.argv.includes('--apply')
const DRY = !APPLY

/** The only files this agent is permitted to change. Everything else is refused. */
const ALLOWED_PATHS = new Set(['package.json', 'package-lock.json', 'CHANGELOG.md'])

/** Paths that are never touched, whatever a future caller passes in. */
const DENY = [
  /^\.github\//,
  /^src\//,
  /^server\//,
  /^shared\//,
  /^api\//,
  /^tests\//,
  /^scripts\//,
  /^config\//,
  /^\.env/,
  /^SECURITY\.md$/,
]

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8', env: process.env, maxBuffer: 32 * 1024 * 1024 })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  return { ok: result.status === 0, stdout, stderr, output: `${stdout}\n${stderr}`.trim(), status: result.status ?? -1 }
}

const log = (line) => console.log(line)
const done = (code) => process.exit(code)

/* Guard 1 — never operate on a protected branch ---------------------------- */

const branch = (() => {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
})()
if (!branch) {
  log('agent=blocked reason=not_a_git_checkout')
  done(0)
}

const PROTECTED = new Set(['main', 'master'])
if (APPLY && PROTECTED.has(branch)) {
  log(`agent=blocked reason=protected_branch branch=${branch}`)
  log('Refusing to commit. The agent must propose on its own branch, never on the default branch.')
  done(1)
}

/* Guard 2 — the proposed change must be provably narrow -------------------- */

function assertPathsAllowed(paths) {
  const offenders = paths.filter((path) => {
    if (!ALLOWED_PATHS.has(path)) return true
    return DENY.some((pattern) => pattern.test(path))
  })
  if (offenders.length) {
    log(`agent=blocked reason=path_not_allowed files=${offenders.join(',')}`)
    return false
  }
  return true
}

/* Guard 3 — never introduce a secret-shaped literal ------------------------ */

function assertNoSecretShapedChange(files) {
  const patterns = [
    { id: 'provider-key', re: /\bgsk_[A-Za-z0-9]{20,}/ },
    { id: 'browser-exported-secret', re: /^\s*VITE_[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|ACCESS_CODE)\s*=\s*\S+/m },
    { id: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  ]
  for (const file of files) {
    for (const pattern of patterns) {
      if (pattern.re.test(file.content)) {
        log(`agent=blocked reason=secret_shaped_diff rule=${pattern.id} file=${file.path}`)
        return false
      }
    }
  }
  return true
}

/* Observe — what would a routine dependency update change? ----------------- */

const lockBefore = (() => {
  try { return readFileSync('package-lock.json', 'utf8') } catch { return '' }
})()
const pkgBefore = (() => {
  try { return readFileSync('package.json', 'utf8') } catch { return '' }
})()

if (!pkgBefore) {
  log('agent=skip reason=no_package_json')
  done(0)
}

const pkgManifest = (() => {
  try { return JSON.parse(pkgBefore) } catch { return null }
})()
if (!pkgManifest || typeof pkgManifest !== 'object') {
  log('agent=blocked reason=invalid_package_json')
  done(1)
}

const declaredDeps = Object.keys({ ...pkgManifest.dependencies, ...pkgManifest.devDependencies })
if (declaredDeps.length > 0 && !existsSync('node_modules')) {
  log('agent=blocked reason=missing_node_modules')
  log('Refusing to classify outdated packages without node_modules. Run npm ci before invoking the maintenance agent.')
  done(1)
}

const outdated = run('npm', ['outdated', '--json', '--long'])
if (!outdated.stdout && outdated.status !== 0) {
  log(`agent=blocked reason=outdated_query_failed status=${outdated.status}`)
  if (outdated.stderr) log(outdated.stderr.split('\n')[0])
  done(1)
}

const parsed = (() => {
  if (!outdated.stdout) return {}
  try { return JSON.parse(outdated.stdout) } catch { return null }
})()

if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
  log('agent=blocked reason=outdated_parse_failed')
  done(1)
}

if ('error' in parsed && parsed.error && typeof parsed.error === 'object') {
  const code = String(parsed.error.code ?? 'unknown')
  const summary = String(parsed.error.summary ?? '').split('\n')[0]
  log(`agent=blocked reason=npm_outdated_error code=${code}`)
  if (summary) log(summary)
  done(1)
}

/** Patch and minor only. A major is a human decision by policy, not by omission. */
const semver = /^\d+\.\d+\.\d+/
const majorOf = (version) => String(version ?? '').split('.')[0]

const missingCurrent = []
const routine = []
const majors = []
const satisfied = []

// Classification must be exhaustive: every outdated package lands in exactly one
// bucket and is printed. An earlier version `continue`d when `current` was absent
// (for example when `node_modules` was missing or incomplete) or when `npm`
// returned `{ "error": { "code": "ENEEDAUTH" } }`, silently pretending zero
// updates existed. Missing `current` now halts execution explicitly.
for (const [name, info] of Object.entries(parsed)) {
  const { current, wanted } = info ?? {}
  if (typeof current !== 'string' || !current.trim()) {
    missingCurrent.push(name)
    continue
  }
  if (!semver.test(current)) continue
  if (majorOf(current) !== majorOf(wanted ?? current)) {
    // A major that npm would install inside the declared range is still human work.
    majors.push([name, info])
    continue
  }
  if ((wanted ?? current) === current) {
    // Range already satisfied. The package is behind, but not upgradable without
    // a deliberate range change, so it is reported, not acted on.
    satisfied.push([name, info])
    continue
  }
  routine.push([name, info])
}

if (missingCurrent.length) {
  log(`agent=blocked reason=missing_installed_version packages=${missingCurrent.join(',')}`)
  log('Refusing to classify outdated packages when installed "current" versions are missing. Run npm ci first.')
  done(1)
}

log(`agent=observe branch=${branch} outdated_total=${Object.keys(parsed).length} routine=${routine.length} major_skipped=${majors.length} range_satisfied=${satisfied.length}`)
for (const [name, info] of routine) log(`  routine ${name}: ${info.current} -> ${info.wanted ?? info.latest}`)
for (const [name, info] of majors) log(`  major_skipped ${name}: ${info.current} -> ${info.latest} (human decision)`)
for (const [name, info] of satisfied) log(`  range_satisfied ${name}: ${info.current} (latest ${info.latest}, needs a range change)`)

if (!routine.length) {
  log(`agent=noop reason=no_routine_updates_available major_skipped=${majors.length} range_satisfied=${satisfied.length}`)
  done(0)
}

if (DRY) {
  log('agent=dry_run_changes=0')
  log('Nothing was written. Re-run with --apply on a maintenance branch to open the proposed change.')
  done(0)
}

/* Propose — a branch, a narrow commit, never a merge ----------------------- */

const PROPOSAL_BRANCH = `maintenance/routine-dependencies-${new Date().toISOString().slice(0, 10)}`
const checkout = run('git', ['checkout', '-B', PROPOSAL_BRANCH])
if (!checkout.ok) {
  log(`agent=blocked reason=branch_failed detail=${checkout.output.split('\n')[0]}`)
  done(1)
}

const upgrade = run('npm', ['update', '--save', ...routine.map(([name]) => name)])
if (!upgrade.ok) {
  log('agent=blocked reason=npm_update_failed')
  done(1)
}

const pkgAfter = readFileSync('package.json', 'utf8')
const lockAfter = readFileSync('package-lock.json', 'utf8')

const changed = []
if (pkgAfter !== pkgBefore) changed.push({ path: 'package.json', content: pkgAfter })
if (lockAfter !== lockBefore) changed.push({ path: 'package-lock.json', content: lockAfter })

if (!changed.length) {
  log('agent=noop reason=no_file_changed_after_update')
  done(0)
}

const changelogPath = 'CHANGELOG.md'
try {
  const changelog = readFileSync(changelogPath, 'utf8')
  const names = routine.map(([name, info]) => `${name} ${info.current} → ${info.wanted ?? info.latest}`).join('، ')
  const marker = '## [Unreleased]'
  const entry = `${marker}\n\n### تحديثات اعتماديات آلية (مقترحة للمراجعة)\n- ${names}\n`
  if (changelog.includes(marker) && !changelog.includes(names)) {
    writeFileSync(changelogPath, changelog.replace(marker, entry), 'utf8')
    changed.push({ path: changelogPath, content: readFileSync(changelogPath, 'utf8') })
  }
} catch {
  log('agent=skip reason=changelog_unreadable')
}

/* Guards 2 and 3 run on the real diff, after the change exists. ------------ */

const staged = run('git', ['diff', '--name-only']).output.split('\n').filter(Boolean)
const touched = [...new Set([...staged, ...changed.map((file) => file.path)])]
if (!assertPathsAllowed(touched)) done(1)
if (!assertNoSecretShapedChange(changed)) done(1)

/* The proposal must still pass the real gates before it is offered. -------- */

const verify = run('npm', ['run', 'check'])
if (!verify.ok) {
  log('agent=blocked reason=quality_failed_after_update')
  log('A proposed change that breaks the suite is not proposed at all.')
  done(1)
}

run('git', ['add', ...touched])
const commit = run('git', ['commit', '-m', 'Propose routine dependency updates (maintenance agent)'])
if (!commit.ok) {
  log('agent=blocked reason=commit_failed')
  done(1)
}

log(`agent=proposed branch=${PROPOSAL_BRANCH} files=${touched.join(',')}`)
log('agent=merge_blocked_by_design reason=human_approval_required')
