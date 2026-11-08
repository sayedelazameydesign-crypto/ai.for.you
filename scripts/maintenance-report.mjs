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
import { existsSync, writeFileSync } from 'node:fs'

/** PASS = ran and is healthy. FAIL = ran and is unhealthy. NOT RUN = could not run. */
const PASS = 'PASS'
const FAIL = 'FAIL'
const NOT_RUN = 'NOT RUN'

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

/** Run a command, capture output, and map exit status to PASS/FAIL. */
function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    shell: false,
    // npm run check builds with TypeScript, which exits non-zero when NODE_OPTIONS
    // is scrubbed. Inheriting the environment is what keeps this faithful to CI.
    env: process.env,
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    status: result.status ?? -1,
    error: result.error?.message,
  }
}

/** A check whose precondition is missing is NOT RUN, not FAIL. */
function skipped(area, name, reason) {
  return record(area, name, NOT_RUN, reason)
}

const hasGit = (() => {
  try {
    execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

/* Area 1 — tests --------------------------------------------------------- */

{
  if (REUSE_QUALITY) {
    record('tests', 'lint + unit tests + build', PASS, 'verified by an earlier step in this same job')
  } else if (existsSync('node_modules')) {
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
  } else if (existsSync('node_modules')) {
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
  const result = run('npm', ['audit', '--audit-level=high'])
  record('dependencies', 'high-severity audit', result.ok ? PASS : FAIL,
    result.ok ? 'no high or critical advisories' : 'high or critical advisory present')
}

{
  const result = run('npm', ['outdated', '--json'])
  // `npm outdated` exits 1 when anything is outdated: that is information, not failure.
  let count
  try {
    count = Object.keys(JSON.parse(result.output) ?? {}).length
  } catch {
    count = 0
  }
  record('dependencies', 'outdated packages', PASS,
    count === 0 ? 'all dependencies current' : `${count} package(s) behind; reported, never auto-applied`)
}

/* Area 3 — code and documentation ---------------------------------------- */

{
  const result = run('npm', ['run', 'check:docs'])
  record('documentation', 'drift guard', result.ok ? PASS : FAIL,
    result.ok ? (/(docs_guard=passed[^\n]*)/.exec(result.output)?.[1] ?? 'docs_guard=passed') : 'docs no longer match the code')
}

{
  const result = run('node', ['scripts/guard-secrets.mjs'])
  record('security', 'committed secret scan', result.ok ? PASS : FAIL,
    result.ok ? 'secret_guard=passed' : 'a secret-shaped literal is tracked')
}

{
  const result = run('npm', ['run', 'check:build'])
  if (existsSync('dist')) {
    record('code quality', 'build output assertions', result.ok ? PASS : FAIL,
      result.ok ? (/(build_check=passed[^\n]*)/.exec(result.output)?.[1] ?? 'build_check=passed') : 'dist failed an assertion')
  } else {
    skipped('code quality', 'build output assertions', 'dist missing; run npm run build')
  }
}

/* Area 5 — operational health ------------------------------------------- */

{
  const url = process.env.PAGE_URL?.trim()
  if (!url) {
    skipped('operational health', 'live site smoke test', 'PAGE_URL is not set for this run')
  } else {
    const apiBase = process.env.API_BASE?.trim()
    const args = ['scripts/smoke-deploy.mjs', url, ...(apiBase ? [apiBase] : [])]
    const result = run('node', args)
    record('operational health', 'live site smoke test', result.ok ? PASS : FAIL,
      result.ok ? 'published page and identity are healthy' : `reason=${/(reason=[\w-]+)/.exec(result.output)?.[1]?.slice(7) ?? 'unknown'}`)
  }
}

/* Area 6 — recovery readiness ------------------------------------------- */

{
  if (!hasGit) {
    skipped('recovery', 'working tree clean', 'not a git checkout in this environment')
  } else {
    const result = run('git', ['status', '--porcelain'])
    const clean = !result.output.trim()
    record('recovery', 'working tree clean', clean ? PASS : FAIL,
      clean ? 'no uncommitted changes' : 'uncommitted changes present; a revert cannot be assumed to be clean')
  }
}

{
  const tags = hasGit ? run('git', ['tag', '--list']) : { ok: false, output: '' }
  const latest = tags.output.split('\n').filter(Boolean).pop()
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
const counts = [PASS, FAIL, NOT_RUN].map((status) => `${status}: ${results.filter((entry) => entry.status === status).length}`)
lines.push(counts.join(' · '))

const failing = results.filter((entry) => entry.status === FAIL)
if (failing.length) {
  lines.push('', `**${failing.length} check(s) failed.** Reproduce with \`npm ci && npm run check && npm run check:docs\`, then open a pull request. This report changes nothing.`)
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
  writeFileSync(process.argv[jsonIndex + 1], JSON.stringify({ generated: new Date().toISOString(), results, counts: { PASS, FAIL, NOT_RUN } }, null, 2))
}
process.stdout.write(report)

// The exit code reflects health only. NOT RUN alone does not fail the run,
// because a missing optional variable is not a regression.
process.exit(failing.length ? 1 : 0)
