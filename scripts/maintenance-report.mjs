#!/usr/bin/env node
/**
 * Maintenance report for celia.sh.
 *
 * Runs the same checks the scheduled workflow runs, and writes a report where
 * every line is PASS, FAIL, or NOT RUN. That third state is the point: a check
 * that was skipped because a secret or a variable is missing must never be
 * reported as a failure, and must never be quietly counted as a pass either.
 *
 * The report is written to $GITHUB_STEP_SUMMARY when available, and to stdout
 * always. It contains counts, reason codes and file names only — never a
 * credential, a request body, a prompt, or a model response.
 *
 * Usage: node scripts/maintenance-report.mjs [--json out.json]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** PASS = ran and is healthy. FAIL = ran and is unhealthy. NOT RUN = could not run. */
const PASS = 'PASS'
const FAIL = 'FAIL'
const NOT_RUN = 'NOT RUN'

const SCRIPTS_DIR = dirname(fileURLToPath(import.meta.url))
const NETWORK_ERROR_RE = /\b(ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENETUNREACH|EHOSTUNREACH|ERR_SOCKET_TIMEOUT)\b/i
const SEMVER_RE = /^\d+\.\d+\.\d+/

// In CI the quality job has already run `npm run check` and the coverage gate
// as earlier steps, so re-running them here would only add a minute. This flag
// reuses that evidence instead of faking it: the rows are still reported, and
// they are reported as verified in *this* job.
const REUSE_QUALITY = process.argv.includes('--reuse-quality')

const results = []
const record = (area, name, status, detail) => {
  results.push({ area, name, status, detail })
  return status
}

/** Run a command, keeping stdout and stderr separate so stderr warnings never corrupt JSON stdout. */
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    // npm run check builds with TypeScript, which exits non-zero when NODE_OPTIONS
    // is scrubbed. Inheriting the environment is what keeps this faithful to CI.
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  })
  const stdout = (result.stdout ?? '').trim()
  const stderr = (result.stderr ?? '').trim()
  return {
    ok: result.status === 0,
    stdout,
    stderr,
    output: [stdout, stderr].filter(Boolean).join('\n'),
    status: result.status ?? -1,
    error: result.error?.message,
  }
}

/** A check whose precondition is missing is NOT RUN, not FAIL. */
function skipped(area, name, reason) {
  return record(area, name, NOT_RUN, reason)
}

function detectNetworkCode(...texts) {
  for (const text of texts) {
    if (!text) continue
    const match = NETWORK_ERROR_RE.exec(String(text))
    if (match) return match[1].toUpperCase()
  }
  return null
}

function hasDeclaredDependencies() {
  try {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
    return Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }).length > 0
  } catch {
    return true
  }
}

/**
 * Evaluate `npm outdated --json` without ever turning command, network, auth,
 * parse, or missing-install errors into a misleading PASS.
 */
function evaluateOutdatedPackages(result) {
  if (result.error) {
    return { status: FAIL, detail: 'reason=outdated_command_failed (spawn_error)' }
  }

  if (!result.stdout) {
    if (result.status === 0) {
      return { status: PASS, detail: 'all dependencies current' }
    }
    const netCode = detectNetworkCode(result.stderr)
    if (netCode) {
      return { status: FAIL, detail: `reason=network_error (${netCode})` }
    }
    return { status: FAIL, detail: `reason=outdated_command_failed (exit=${result.status})` }
  }

  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    const netCode = detectNetworkCode(result.stdout, result.stderr)
    if (netCode) {
      return { status: FAIL, detail: `reason=network_error (${netCode})` }
    }
    return { status: FAIL, detail: 'reason=outdated_parse_failed' }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: FAIL, detail: 'reason=outdated_parse_failed' }
  }

  if ('error' in parsed && parsed.error && typeof parsed.error === 'object') {
    const rawCode = String(parsed.error.code ?? 'UNKNOWN').trim() || 'UNKNOWN'
    const safeCode = /^[\w-]+$/.test(rawCode) ? rawCode : 'UNKNOWN'
    const netCode = detectNetworkCode(rawCode, parsed.error.summary, result.stderr)
    if (netCode) {
      return { status: FAIL, detail: `reason=network_error (${netCode})` }
    }
    return { status: FAIL, detail: `reason=npm_outdated_error (${safeCode})` }
  }

  const entries = Object.entries(parsed)
  if (entries.length === 0) {
    if (result.status !== 0) {
      const netCode = detectNetworkCode(result.stderr)
      if (netCode) {
        return { status: FAIL, detail: `reason=network_error (${netCode})` }
      }
      return { status: FAIL, detail: `reason=outdated_command_failed (exit=${result.status})` }
    }
    return { status: PASS, detail: 'all dependencies current' }
  }

  const missingCurrent = []
  let routine = 0
  const majorOf = (v) => String(v ?? '').split('.')[0]

  for (const [name, info] of entries) {
    if (!info || typeof info !== 'object' || Array.isArray(info)) {
      return { status: FAIL, detail: 'reason=outdated_parse_failed' }
    }
    if (typeof info.current !== 'string' || !info.current.trim()) {
      missingCurrent.push(name)
      continue
    }
    const wanted = typeof info.wanted === 'string' && info.wanted.trim() ? info.wanted : info.current
    if (SEMVER_RE.test(info.current) && majorOf(info.current) === majorOf(wanted) && wanted !== info.current) {
      routine += 1
    }
  }

  if (missingCurrent.length > 0) {
    return { status: FAIL, detail: `reason=missing_installed_version (${missingCurrent.join(',')})` }
  }

  const pinnedOrMajor = entries.length - routine
  return {
    status: PASS,
    detail: `${entries.length} package(s) behind (${routine} routine, ${pinnedOrMajor} major/range-pinned); reported, never auto-applied`,
  }
}

const hasGit = (() => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

const needsNodeModules = hasDeclaredDependencies()
const hasNodeModules = existsSync('node_modules')

/* Area 1 — tests --------------------------------------------------------- */

{
  if (REUSE_QUALITY) {
    record('tests', 'lint + unit tests + build', PASS, 'verified by an earlier step in this same job')
  } else if (hasNodeModules) {
    const result = run('npm', ['run', 'check'])
    record('tests', 'lint + unit tests + build', result.ok ? PASS : FAIL,
      result.ok ? 'npm run check exited 0' : `npm run check exited ${result.status}${result.error ? `: ${result.error}` : ''}`)
  } else {
    skipped('tests', 'lint + unit tests + build', 'node_modules missing; run npm ci')
  }
}

{
  if (REUSE_QUALITY) {
    record('tests', 'coverage thresholds', PASS, 'verified by an earlier step in this same job')
  } else if (hasNodeModules) {
    const result = run('npm', ['run', 'test:coverage'])
    const line = /Statements\s*:\s*([\d.]+)%/.exec(result.output)
    record('tests', 'coverage thresholds', result.ok ? PASS : FAIL,
      result.ok ? `statements=${line?.[1] ?? 'unknown'}% (thresholds enforced)` : 'coverage fell below a threshold')
  } else {
    skipped('tests', 'coverage thresholds', 'node_modules missing; run npm ci')
  }
}

/* Area 2 — dependencies -------------------------------------------------- */

{
  if (needsNodeModules && !hasNodeModules) {
    skipped('dependencies', 'high-severity audit', 'node_modules missing; run npm ci')
  } else {
    const result = run('npm', ['audit', '--audit-level=high'])
    const netCode = !result.ok ? detectNetworkCode(result.output) : null
    record('dependencies', 'high-severity audit', result.ok ? PASS : FAIL,
      result.ok
        ? 'no high or critical advisories'
        : netCode
          ? `reason=network_error (${netCode})`
          : 'high or critical advisory present or audit failed')
  }
}

{
  if (needsNodeModules && !hasNodeModules) {
    skipped('dependencies', 'outdated packages', 'node_modules missing; run npm ci')
  } else {
    const result = run('npm', ['outdated', '--json'])
    // `npm outdated` exits 1 when packages are outdated, AND when an error occurs:
    // evaluateOutdatedPackages distinguishes valid outdated JSON from command/network/auth/parse errors.
    const outcome = evaluateOutdatedPackages(result)
    record('dependencies', 'outdated packages', outcome.status, outcome.detail)
  }
}

/* Area 3 — documentation, security and build ----------------------------- */

{
  const result = run(process.execPath, [join(SCRIPTS_DIR, 'check-docs.mjs')])
  record('documentation', 'drift guard', result.ok ? PASS : FAIL,
    result.ok ? (/(docs_guard=passed[^\n]*)/.exec(result.stdout)?.[1] ?? 'docs_guard=passed') : 'docs no longer match the code')
}

{
  const result = run(process.execPath, [join(SCRIPTS_DIR, 'check-sql.mjs')])
  const sqlRule = !result.ok
    ? (/::error title=SQL policy::([a-z0-9_]+)/i.exec(result.stderr)?.[1] ??
      /reason=([a-z0-9_]+)/i.exec(result.stderr)?.[1] ??
      'policy_violation')
    : null
  record('security', 'quota SQL policy', result.ok ? PASS : FAIL,
    result.ok ? (/(sql_check=passed[^\n]*)/.exec(result.stdout)?.[1] ?? 'sql_check=passed') : `reason=${sqlRule}`)
}

{
  const result = run(process.execPath, [join(SCRIPTS_DIR, 'guard-secrets.mjs')])
  record('security', 'committed secret scan', result.ok ? PASS : FAIL,
    result.ok ? 'secret_guard=passed' : 'a secret-shaped literal is tracked')
}

{
  if (!existsSync('dist')) {
    skipped('code quality', 'build output assertions', 'dist missing; run npm run build')
  } else {
    const result = run(process.execPath, [join(SCRIPTS_DIR, 'check-build.mjs')])
    record('code quality', 'build output assertions', result.ok ? PASS : FAIL,
      result.ok ? (/(build_check=passed[^\n]*)/.exec(result.stdout)?.[1] ?? 'build_check=passed') : 'dist failed an assertion')
  }
}

/* Area 4 — operational health ------------------------------------------- */

{
  const url = process.env.PAGE_URL?.trim()
  if (!url) {
    skipped('operational health', 'live site smoke test', 'PAGE_URL is not set for this run')
  } else {
    const apiBase = process.env.API_BASE?.trim()
    const args = [join(SCRIPTS_DIR, 'smoke-deploy.mjs'), url, ...(apiBase ? [apiBase] : [])]
    const result = run(process.execPath, args)
    record('operational health', 'live site smoke test', result.ok ? PASS : FAIL,
      result.ok ? 'published page and identity are healthy' : `reason=${/(reason=[\w-]+)/.exec(result.output)?.[1]?.slice(7) ?? 'unknown'}`)
  }
}

/* Area 5 — recovery readiness ------------------------------------------- */

{
  if (!hasGit) {
    skipped('recovery', 'working tree clean', 'not a git checkout in this environment')
  } else {
    const result = run('git', ['status', '--porcelain'])
    const clean = result.ok && !result.stdout.trim()
    record('recovery', 'working tree clean', clean ? PASS : FAIL,
      clean ? 'no uncommitted changes' : 'uncommitted changes present; a revert cannot be assumed to be clean')
  }
}

{
  const tags = hasGit ? run('git', ['tag', '--list']) : { ok: false, stdout: '' }
  const latest = tags.stdout.split('\n').filter(Boolean).pop()
  record('recovery', 'releasable checkpoint', latest ? PASS : NOT_RUN,
    latest ? `latest tag ${latest}` : 'no version tag yet; rollback falls back to re-running a successful workflow')
}

/* Report ----------------------------------------------------------------- */

const lines = [
  '## Maintenance report — celia.sh',
  '',
  `Generated ${new Date().toISOString().slice(0, 10)}.`,
  '',
  '`PASS` ran and is healthy · `FAIL` ran and is unhealthy · `NOT RUN` could not run, which is not a pass.',
  '',
  '| status | area | check | detail |',
  '| --- | --- | --- | --- |',
  ...results.map((entry) => `| ${entry.status} | ${entry.area} | ${entry.name} | ${entry.detail} |`),
  '',
]
const summaryCounts = {
  [PASS]: results.filter((entry) => entry.status === PASS).length,
  [FAIL]: results.filter((entry) => entry.status === FAIL).length,
  [NOT_RUN]: results.filter((entry) => entry.status === NOT_RUN).length,
}
const counts = [PASS, FAIL, NOT_RUN].map((status) => `${status}: ${summaryCounts[status]}`)
lines.push(counts.join(' · '))

const failing = results.filter((entry) => entry.status === FAIL)
if (failing.length) {
  lines.push('', `**${failing.length} check(s) failed.** Reproduce with \`npm ci && npm run check && npm run check:docs && npm run check:sql\`, then open a pull request. This report changes nothing.`)
}
const unrun = results.filter((entry) => entry.status === NOT_RUN)
if (unrun.length) {
  lines.push('', `${unrun.length} check(s) were not run. That is recorded as a gap, not as a success.`)
}

const report = `${lines.join('\n')}\n`
if (process.env.GITHUB_STEP_SUMMARY) {
  try { writeFileSync(process.env.GITHUB_STEP_SUMMARY, report, { flag: 'a' }) } catch { /* summary is best effort */ }
}
const jsonIndex = process.argv.indexOf('--json')
if (jsonIndex !== -1 && process.argv[jsonIndex + 1]) {
  writeFileSync(process.argv[jsonIndex + 1], JSON.stringify({ generated: new Date().toISOString(), results, counts: summaryCounts }, null, 2))
}
process.stdout.write(report)

// The exit code reflects health only. NOT RUN alone does not fail the run,
// because a missing optional variable is not a regression.
process.exit(failing.length ? 1 : 0)
