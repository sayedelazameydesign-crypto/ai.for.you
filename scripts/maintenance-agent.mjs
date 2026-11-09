#!/usr/bin/env node
/**
 * Maintenance agent — propose, never decide.
 *
 * Pipeline position: Propose. It observes outdated dependencies and, when
 * routine patch/minor updates exist, proposes them on an isolated
 * `maintenance/...` branch for human review.
 *
 * Hard limits, enforced in code below and not only in prose:
 *
 *   1. It never commits or pushes to a protected branch (`main`, `master`).
 *      When invoked on `main` (for example from a scheduled workflow):
 *        - If zero routine updates exist, it exits 0 cleanly as `agent=noop`
 *          without creating a branch, commit, or pull request.
 *        - If routine updates exist, it creates/resets an isolated
 *          `maintenance/...` branch from the clean base commit, verifies
 *          `HEAD` moved off `main`, applies updates there only, and refuses
 *          any commit or push targeting a protected branch.
 *   2. It never merges. Neither this script nor the workflow has a merge step.
 *   3. It never edits application code, tests, workflows, or secrets. The
 *      allowlist is `package.json`, `package-lock.json`, `CHANGELOG.md`.
 *   4. It never runs on a `pull_request` event, so a fork cannot reach tokens.
 *   5. It refuses a diff (tracked or untracked) touching any path outside
 *      `ALLOWED_PATHS` or matching `DENY`, rolling back uncommitted edits.
 *   6. It refuses secret-shaped values or `VITE_` secret keys, rolling back.
 *
 * Usage:
 *   node scripts/maintenance-agent.mjs --dry-run
 *   node scripts/maintenance-agent.mjs --apply [--proposal-branch maintenance/...]
 *   node scripts/maintenance-agent.mjs --push [maintenance/...]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

const args = process.argv.slice(2)

function readFlagValue(flag) {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === flag) {
      const next = args[i + 1]
      return next && !next.startsWith('--') ? next : ''
    }
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1)
  }
  return null
}

const PUSH_HAS_FLAG = args.includes('--push') || args.some((arg) => arg.startsWith('--push='))
const PUSH_TARGET_ARG = readFlagValue('--push')
const EXPLICIT_PROPOSAL_BRANCH = readFlagValue('--proposal-branch')
const APPLY = args.includes('--apply')
const DRY = !APPLY && !PUSH_HAS_FLAG

/** Protected branches that must never receive a direct commit or push. */
const PROTECTED = new Set(['main', 'master'])

/** Every proposal branch must live strictly under `maintenance/`. */
const PROPOSAL_BRANCH_RE = /^maintenance\/[a-z0-9._-]+$/

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

const log = (line) => console.log(line)
const done = (code) => process.exit(code)
const firstLine = (text) => String(text ?? '').split('\n').find(Boolean) ?? ''

const run = (command, cmdArgs) => {
  const result = spawnSync(command, cmdArgs, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  return {
    ok: result.status === 0,
    stdout,
    stderr,
    output: `${stdout}\n${stderr}`.trim(),
    status: result.status ?? -1,
  }
}

function currentGitBranch() {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function revParse(ref) {
  try {
    return execFileSync('git', ['rev-parse', '--verify', '--quiet', ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function normalizeBranchName(raw) {
  return String(raw ?? '').trim().replace(/^refs\/heads\//, '')
}

function validateProposalBranch(candidate, operation = 'branch') {
  const raw = String(candidate ?? '').trim()
  const normalized = normalizeBranchName(raw)
  if (!normalized || normalized === 'HEAD' || PROTECTED.has(normalized) || PROTECTED.has(raw)) {
    log(`agent=blocked reason=protected_branch operation=${operation} branch=${normalized || 'unknown'}`)
    log('Refusing to target a protected branch. Proposals must use an isolated maintenance/... branch.')
    done(1)
  }
  if (!PROPOSAL_BRANCH_RE.test(normalized)) {
    log(`agent=blocked reason=invalid_proposal_branch operation=${operation} branch=${raw}`)
    log('Proposal branch names must match maintenance/<slug>.')
    done(1)
  }
  return normalized
}

/**
 * Structural git write firewall: intercepts `git commit` and `git push` before
 * `spawnSync` so no code path can ever commit on or push to `main`/`master`.
 */
function runGit(gitArgs) {
  const subcommand = gitArgs[0] ?? ''
  if (subcommand === 'commit') {
    const active = currentGitBranch()
    if (!active || active === 'HEAD' || PROTECTED.has(active) || !PROPOSAL_BRANCH_RE.test(active)) {
      log(`agent=blocked reason=protected_branch operation=commit branch=${active || 'unknown'}`)
      log('Refusing to commit on a protected or non-maintenance branch.')
      done(1)
    }
  }
  if (subcommand === 'push') {
    const positional = gitArgs.slice(1).filter((arg) => !arg.startsWith('-'))
    const refspecs = positional.slice(1)
    const forbiddenFlags = gitArgs.some((arg) => arg === '--all' || arg === '--mirror' || arg === '--tags')
    if (forbiddenFlags || refspecs.length !== 1) {
      log('agent=blocked reason=protected_branch operation=push branch=ambiguous_refspec')
      done(1)
    }
    const [srcRef, dstRef = srcRef] = refspecs[0].split(':')
    const srcBranch = normalizeBranchName(srcRef)
    const dstBranch = normalizeBranchName(dstRef)
    if (
      PROTECTED.has(srcBranch) ||
      PROTECTED.has(dstBranch) ||
      !PROPOSAL_BRANCH_RE.test(srcBranch) ||
      srcBranch !== dstBranch ||
      srcRef !== `refs/heads/${srcBranch}` ||
      dstRef !== `refs/heads/${dstBranch}`
    ) {
      const offending = PROTECTED.has(dstBranch) ? dstBranch : srcBranch
      log(`agent=blocked reason=protected_branch operation=push branch=${offending || 'invalid'}`)
      log('Refusing to push to a protected or non-maintenance branch.')
      done(1)
    }
  }
  return run('git', gitArgs)
}

if (APPLY && PUSH_HAS_FLAG) {
  log('agent=blocked reason=conflicting_flags detail=apply_and_push_are_separate_steps')
  done(1)
}

/* Snapshot protected branch SHAs at startup to prove immutability ---------- */

const initialBranch = currentGitBranch()
if (!initialBranch) {
  log('agent=blocked reason=not_a_git_checkout')
  done(DRY ? 0 : 1)
}

const protectedRefsBefore = new Map()
for (const name of PROTECTED) {
  const sha = revParse(`refs/heads/${name}`)
  if (sha) protectedRefsBefore.set(name, sha)
}

function assertProtectedRefsUnchanged() {
  for (const [name, expectedSha] of protectedRefsBefore.entries()) {
    const actualSha = revParse(`refs/heads/${name}`)
    if (actualSha !== expectedSha) {
      run('git', ['update-ref', `refs/heads/${name}`, expectedSha])
      log(`agent=blocked reason=protected_branch operation=mutation_detected branch=${name}`)
      done(1)
    }
  }
}

function assertCleanWorkingTree(contextBranch) {
  const status = run('git', ['status', '--porcelain'])
  if (!status.ok) {
    log('agent=blocked reason=git_status_failed')
    done(1)
  }
  if (status.stdout.length > 0) {
    log(`agent=blocked reason=dirty_working_tree branch=${contextBranch}`)
    log('Refusing to operate on a dirty working tree. Commit, stash, or clean changes first.')
    done(1)
  }
}

/* Guarded `--push` mode (used by workflow after `--apply` proposes) -------- */

if (PUSH_HAS_FLAG) {
  const requested = PUSH_TARGET_ARG ? PUSH_TARGET_ARG : initialBranch
  const targetBranch = validateProposalBranch(requested, 'push')
  if (initialBranch !== targetBranch) {
    log(`agent=blocked reason=branch_mismatch operation=push head=${initialBranch} target=${targetBranch}`)
    done(1)
  }
  assertCleanWorkingTree(initialBranch)
  assertProtectedRefsUnchanged()

  const remoteMainBefore = run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/main'])
  if (!remoteMainBefore.ok) {
    log(`agent=blocked reason=push_failed detail=${firstLine(remoteMainBefore.output)}`)
    done(1)
  }
  const remoteMainShaBefore = remoteMainBefore.stdout.split(/\s+/)[0] ?? ''

  const lsTarget = run('git', ['ls-remote', '--heads', 'origin', `refs/heads/${targetBranch}`])
  if (!lsTarget.ok) {
    log(`agent=blocked reason=push_failed detail=${firstLine(lsTarget.output)}`)
    done(1)
  }
  const remoteTargetSha = lsTarget.stdout.split(/\s+/)[0] ?? ''

  const pushResult = runGit([
    'push',
    `--force-with-lease=refs/heads/${targetBranch}:${remoteTargetSha}`,
    'origin',
    `refs/heads/${targetBranch}:refs/heads/${targetBranch}`,
  ])
  if (!pushResult.ok) {
    log(`agent=blocked reason=push_failed detail=${firstLine(pushResult.output)}`)
    done(1)
  }

  assertProtectedRefsUnchanged()
  if (remoteMainShaBefore) {
    const remoteMainAfter = run('git', ['ls-remote', '--heads', 'origin', 'refs/heads/main'])
    const remoteMainShaAfter = remoteMainAfter.stdout.split(/\s+/)[0] ?? ''
    if (remoteMainShaAfter !== remoteMainShaBefore) {
      log('agent=blocked reason=protected_branch operation=remote_main_changed branch=main')
      done(1)
    }
  }

  log(`agent=pushed branch=${targetBranch} lease=${remoteTargetSha || 'new'}`)
  done(0)
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

/* Validate `--apply` preconditions before touching anything ---------------- */

const defaultProposalBranch = `maintenance/routine-dependencies-${new Date().toISOString().slice(0, 10)}`
const PROPOSAL_BRANCH = APPLY
  ? validateProposalBranch(
      EXPLICIT_PROPOSAL_BRANCH !== null ? EXPLICIT_PROPOSAL_BRANCH : defaultProposalBranch,
      'apply',
    )
  : defaultProposalBranch

if (APPLY) {
  if (initialBranch === 'HEAD') {
    log('agent=blocked reason=detached_head')
    done(1)
  }
  assertCleanWorkingTree(initialBranch)
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
  if (outdated.stderr) log(firstLine(outdated.stderr))
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
  const summary = firstLine(parsed.error.summary)
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
// bucket and is printed. Missing `current` halts execution explicitly.
for (const [name, info] of Object.entries(parsed)) {
  const { current, wanted } = info ?? {}
  if (typeof current !== 'string' || !current.trim()) {
    missingCurrent.push(name)
    continue
  }
  if (!semver.test(current)) continue
  if (majorOf(current) !== majorOf(wanted ?? current)) {
    majors.push([name, info])
    continue
  }
  if ((wanted ?? current) === current) {
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

log(`agent=observe branch=${initialBranch} outdated_total=${Object.keys(parsed).length} routine=${routine.length} major_skipped=${majors.length} range_satisfied=${satisfied.length}`)
for (const [name, info] of routine) log(`  routine ${name}: ${info.current} -> ${info.wanted ?? info.latest}`)
for (const [name, info] of majors) log(`  major_skipped ${name}: ${info.current} -> ${info.latest} (human decision)`)
for (const [name, info] of satisfied) log(`  range_satisfied ${name}: ${info.current} (latest ${info.latest}, needs a range change)`)

if (!routine.length) {
  assertProtectedRefsUnchanged()
  log(`agent=noop reason=no_routine_updates_available branch=${initialBranch} major_skipped=${majors.length} range_satisfied=${satisfied.length}`)
  done(0)
}

if (DRY) {
  log('agent=dry_run_changes=0')
  log('Nothing was written. Re-run with --apply to create an isolated maintenance branch proposal.')
  done(0)
}

/* Propose — isolate onto `maintenance/...` from clean base, never `main` --- */

assertCleanWorkingTree(initialBranch)

const localMainSha = revParse('refs/heads/main')
const baseCommit = initialBranch === PROPOSAL_BRANCH && localMainSha
  ? localMainSha
  : revParse('HEAD')

if (!baseCommit) {
  log('agent=blocked reason=missing_base_commit')
  done(1)
}

const preexistingBranchSha = revParse(`refs/heads/${PROPOSAL_BRANCH}`)
const preexistingBranch = Boolean(preexistingBranchSha)

const checkout = runGit(['checkout', '-B', PROPOSAL_BRANCH, baseCommit])
if (!checkout.ok) {
  assertProtectedRefsUnchanged()
  log(`agent=blocked reason=branch_failed detail=${firstLine(checkout.output)}`)
  done(1)
}

function rollbackProposalBranch() {
  run('git', ['reset', '--hard', baseCommit])
  run('git', ['clean', '-fd'])
  if (initialBranch && initialBranch !== PROPOSAL_BRANCH) {
    run('git', ['checkout', '-f', initialBranch])
    if (preexistingBranchSha) {
      run('git', ['update-ref', `refs/heads/${PROPOSAL_BRANCH}`, preexistingBranchSha])
    } else {
      run('git', ['branch', '-D', PROPOSAL_BRANCH])
    }
  } else if (preexistingBranchSha) {
    run('git', ['reset', '--hard', preexistingBranchSha])
  }
}

const activeBranch = currentGitBranch()
const activeHeadSha = revParse('HEAD')
if (PROTECTED.has(activeBranch)) {
  log(`agent=blocked reason=protected_branch operation=checkout_verification branch=${activeBranch}`)
  done(1)
}
if (activeBranch !== PROPOSAL_BRANCH || activeHeadSha !== baseCommit) {
  rollbackProposalBranch()
  log(`agent=blocked reason=branch_failed detail=unexpected_head_${activeBranch || 'detached'}`)
  done(1)
}

// Re-snapshot manifests from `baseCommit` in case `initialBranch` was a stale `PROPOSAL_BRANCH`.
const basePkg = (() => {
  try { return readFileSync('package.json', 'utf8') } catch { return pkgBefore }
})()
const baseLock = (() => {
  try { return readFileSync('package-lock.json', 'utf8') } catch { return lockBefore }
})()

const upgrade = run('npm', ['update', '--save', ...routine.map(([name]) => name)])
if (!upgrade.ok) {
  rollbackProposalBranch()
  assertProtectedRefsUnchanged()
  log('agent=blocked reason=npm_update_failed')
  done(1)
}

const pkgAfter = (() => {
  try { return readFileSync('package.json', 'utf8') } catch { return '' }
})()
const lockAfter = (() => {
  try { return readFileSync('package-lock.json', 'utf8') } catch { return '' }
})()

const changed = []
if (pkgAfter !== basePkg) changed.push({ path: 'package.json', content: pkgAfter })
if (lockAfter !== baseLock) changed.push({ path: 'package-lock.json', content: lockAfter })

if (!changed.length) {
  rollbackProposalBranch()
  assertProtectedRefsUnchanged()
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

/* Guards 2 and 3 run on all tracked + untracked worktree changes ----------- */

const trackedModified = run('git', ['diff', '--name-only']).stdout.split('\n').filter(Boolean)
const untrackedCreated = run('git', ['ls-files', '--others', '--exclude-standard']).stdout.split('\n').filter(Boolean)
const touched = [...new Set([...trackedModified, ...untrackedCreated, ...changed.map((file) => file.path)])]

const changedForSecretScan = touched.map((path) => {
  const existing = changed.find((entry) => entry.path === path)
  if (existing) return existing
  try {
    return { path, content: readFileSync(path, 'utf8') }
  } catch {
    return { path, content: '' }
  }
})

if (!assertPathsAllowed(touched) || !assertNoSecretShapedChange(changedForSecretScan)) {
  rollbackProposalBranch()
  assertProtectedRefsUnchanged()
  done(1)
}

/* The proposal must still pass the real gates before it is offered --------- */

const verify = run('npm', ['run', 'check'])
if (!verify.ok) {
  rollbackProposalBranch()
  assertProtectedRefsUnchanged()
  log('agent=blocked reason=quality_failed_after_update')
  log('A proposed change that breaks the suite is not proposed at all.')
  done(1)
}

runGit(['add', '--', ...touched])
const commit = runGit(['commit', '-m', 'Propose routine dependency updates (maintenance agent)'])
if (!commit.ok) {
  rollbackProposalBranch()
  assertProtectedRefsUnchanged()
  log('agent=blocked reason=commit_failed')
  done(1)
}

assertProtectedRefsUnchanged()
const proposalCommitSha = revParse('HEAD')
if (!proposalCommitSha || proposalCommitSha === baseCommit || currentGitBranch() !== PROPOSAL_BRANCH) {
  rollbackProposalBranch()
  assertProtectedRefsUnchanged()
  log('agent=blocked reason=commit_failed')
  done(1)
}

log(`agent=proposed branch=${PROPOSAL_BRANCH} base=${baseCommit.slice(0, 12)} preexisting_branch=${preexistingBranch} files=${touched.join(',')}`)
log('agent=merge_blocked_by_design reason=human_approval_required')
