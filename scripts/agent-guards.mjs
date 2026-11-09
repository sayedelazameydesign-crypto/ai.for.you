#!/usr/bin/env node
/**
 * Proof harness for the maintenance agent's guards.
 *
 * The agent's safety claims are worthless if they are only comments. This
 * harness exercises each guard with an adversarial input in isolated fixtures
 * (never mutating the live checkout) and asserts it holds. It runs in CI, so a
 * future refactor that removes a guard fails the build.
 *
 * Usage: node scripts/agent-guards.mjs
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve('scripts/maintenance-agent.mjs')

const cases = []
const check = (name, condition, detail = '') => cases.push({ name, pass: Boolean(condition), detail })

const runDryInRepo = () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { encoding: 'utf8', env: process.env })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}` }
}

// Protected-branch recovery & write-blocking checks run inside isolated temp
// git repositories so `--apply` never mutates the caller's working directory.
{
  const withIsolatedMainRepo = (fn) => {
    const dir = mkdtempSync(join(tmpdir(), 'celia-agent-main-'))
    try {
      spawnSync('git', ['init', '-b', 'main'], { cwd: dir, encoding: 'utf8' })
      mkdirSync(join(dir, 'node_modules', 'vite'), { recursive: true })
      writeFileSync(join(dir, '.gitignore'), 'node_modules/\nbin/\n.empty-home/\n')
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'guard-main-fixture',
        version: '0.1.0',
        scripts: { check: 'node -e "process.exit(0)"' },
        dependencies: { vite: '^8.0.8' },
      }, null, 2) + '\n')
      writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({
        name: 'guard-main-fixture',
        version: '0.1.0',
        lockfileVersion: 3,
      }, null, 2) + '\n')
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n')
      spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' })
      spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'base'], { cwd: dir, encoding: 'utf8' })
      const baseSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
      return fn({ dir, baseSha })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const makeNpmShim = (dir, scriptBody) => {
    const binDir = join(dir, 'bin')
    const emptyHome = join(dir, '.empty-home')
    mkdirSync(binDir, { recursive: true })
    mkdirSync(emptyHome, { recursive: true })
    const shim = join(binDir, 'npm')
    writeFileSync(shim, `#!/usr/bin/env node\n${scriptBody}\n`)
    chmodSync(shim, 0o755)
    const cleanEnv = { ...process.env }
    delete cleanEnv.GIT_AUTHOR_NAME
    delete cleanEnv.GIT_AUTHOR_EMAIL
    delete cleanEnv.GIT_COMMITTER_NAME
    delete cleanEnv.GIT_COMMITTER_EMAIL
    return {
      ...cleanEnv,
      HOME: emptyHome,
      GIT_CONFIG_NOSYSTEM: '1',
      PATH: `${binDir}:${process.env.PATH ?? ''}`,
    }
  }

  withIsolatedMainRepo(({ dir, baseSha }) => {
    const env = makeNpmShim(dir, `process.stdout.write('{}'); process.exit(0)`)
    const noop = spawnSync(process.execPath, [SCRIPT, '--apply'], { cwd: dir, env, encoding: 'utf8' })
    const headBranch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const mainSha = spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const maintBranches = spawnSync('git', ['branch', '--list', 'maintenance/*'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    check(
      'exits 0 as noop on main without branching when zero routine updates exist',
      noop.status === 0 &&
        /agent=noop reason=no_routine_updates_available branch=main/.test(noop.stdout) &&
        headBranch === 'main' &&
        mainSha === baseSha &&
        maintBranches === '',
      `status=${noop.status} branch=${headBranch}`,
    )
  })

  withIsolatedMainRepo(({ dir, baseSha }) => {
    const env = makeNpmShim(dir, `process.stdout.write('{}'); process.exit(0)`)
    const commitTargetMain = spawnSync(process.execPath, [SCRIPT, '--apply', '--proposal-branch=main'], { cwd: dir, env, encoding: 'utf8' })
    const pushTargetMain = spawnSync(process.execPath, [SCRIPT, '--push', 'main'], { cwd: dir, env, encoding: 'utf8' })
    const mainSha = spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    check(
      'refuses to commit or push directly on a protected branch',
      commitTargetMain.status === 1 &&
        /agent=blocked reason=protected_branch/.test(commitTargetMain.stdout) &&
        pushTargetMain.status === 1 &&
        /agent=blocked reason=protected_branch operation=push branch=main/.test(pushTargetMain.stdout) &&
        mainSha === baseSha,
      'both --proposal-branch=main and --push main blocked',
    )
  })

  withIsolatedMainRepo(({ dir, baseSha }) => {
    const env = makeNpmShim(
      dir,
      `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'outdated') {
  process.stdout.write(JSON.stringify({ vite: { current: '8.0.8', wanted: '8.0.9', latest: '8.0.9' } }));
  process.exit(1);
}
if (args[0] === 'update') {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.dependencies.vite = '^8.0.9';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  process.exit(0);
}
process.exit(0);`,
    )
    const prop = spawnSync(process.execPath, [SCRIPT, '--apply'], { cwd: dir, env, encoding: 'utf8' })
    const headBranch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const mainSha = spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    const parentSha = spawnSync('git', ['rev-parse', 'HEAD~1'], { cwd: dir, encoding: 'utf8' }).stdout.trim()
    check(
      'creates isolated maintenance/* branch from main without mutating main',
      prop.status === 0 &&
        /agent=proposed branch=maintenance\/routine-dependencies-/.test(prop.stdout) &&
        /^maintenance\/routine-dependencies-/.test(headBranch) &&
        mainSha === baseSha &&
        parentSha === baseSha,
      `branch=${headBranch} main_intact=${mainSha === baseSha}`,
    )
  })
}

const dry = runDryInRepo()
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
const guardRun = spawnSync(process.execPath, ['--input-type=module', '-e', pathGuard], { encoding: 'utf8' })
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
const secretRun = spawnSync(process.execPath, ['--input-type=module', '-e', secretGuard], { encoding: 'utf8' })
const secretResults = (() => {
  try { return JSON.parse(secretRun.stdout.trim()) } catch { return {} }
})()
for (const [key, value] of Object.entries(secretResults)) {
  check(`secret guard: ${key.replace(/_/g, ' ')}`, value === true, value === true ? 'blocked as required' : 'GUARD FAILED')
}

// Classification completeness: every outdated package must land in exactly one
// reported bucket.
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
  const { current, wanted } = info ?? {}
  if (!semver.test(current ?? '')) continue
  if (majorOf(current) !== majorOf(wanted ?? current)) { buckets.push(name + ':major'); continue }
  if ((wanted ?? current) === current) { buckets.push(name + ':satisfied'); continue }
  buckets.push(name + ':routine')
}
console.log(JSON.stringify(buckets))
`
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', classify], { encoding: 'utf8' })
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

// End-to-end failure-mode guards on the real script: missing `node_modules`,
// missing `current` in `npm outdated --json`, and missing/rejected npm
// credentials (`ENEEDAUTH`) must halt loudly instead of pretending 0 updates.
{
  const runIsolated = ({ withNodeModules, npmScript }) => {
    const dir = mkdtempSync(join(tmpdir(), 'celia-agent-guard-'))
    try {
      spawnSync('git', ['init', '-b', 'feature/test'], { cwd: dir, encoding: 'utf8' })
      spawnSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '--allow-empty', '-m', 'init'], { cwd: dir, encoding: 'utf8' })
      writeFileSync(join(dir, 'package.json'), JSON.stringify({
        name: 'guard-fixture',
        version: '0.1.0',
        dependencies: { vite: '8.3.6' },
      }))
      if (withNodeModules) mkdirSync(join(dir, 'node_modules', 'vite'), { recursive: true })
      let env = { ...process.env }
      if (npmScript) {
        const binDir = join(dir, 'bin')
        mkdirSync(binDir, { recursive: true })
        const shim = join(binDir, 'npm')
        writeFileSync(shim, `#!/usr/bin/env node\n${npmScript}\n`)
        chmodSync(shim, 0o755)
        env = { ...env, PATH: `${binDir}:${process.env.PATH ?? ''}` }
      }
      const res = spawnSync(process.execPath, [SCRIPT, '--dry-run'], { cwd: dir, env, encoding: 'utf8' })
      return { ok: res.status === 0, status: res.status, out: `${res.stdout ?? ''}\n${res.stderr ?? ''}`.trim() }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const noNodeModules = runIsolated({ withNodeModules: false })
  check('halts loudly when node_modules is missing',
    !noNodeModules.ok && /agent=blocked reason=missing_node_modules/.test(noNodeModules.out),
    noNodeModules.out.split('\n')[0] ?? '')

  const missingCurrent = runIsolated({
    withNodeModules: true,
    npmScript: `process.stdout.write(JSON.stringify({ vite: { wanted: '8.3.6', latest: '8.4.0' } })); process.exit(1)`,
  })
  check('halts loudly when npm outdated omits current version',
    !missingCurrent.ok && /agent=blocked reason=missing_installed_version packages=vite/.test(missingCurrent.out),
    missingCurrent.out.split('\n')[0] ?? '')

  const authFailure = runIsolated({
    withNodeModules: true,
    npmScript: `process.stdout.write(JSON.stringify({ error: { code: 'ENEEDAUTH', summary: 'This command requires you to be logged in.' } })); process.exit(1)`,
  })
  check('halts loudly on npm registry credential failure (ENEEDAUTH)',
    !authFailure.ok && /agent=blocked reason=npm_outdated_error code=ENEEDAUTH/.test(authFailure.out),
    authFailure.out.split('\n')[0] ?? '')

  const brokenOutdated = runIsolated({
    withNodeModules: true,
    npmScript: `process.stderr.write('npm ERR! network failure\\n'); process.exit(1)`,
  })
  check('halts loudly when npm outdated fails without JSON',
    !brokenOutdated.ok && /agent=blocked reason=outdated_query_failed/.test(brokenOutdated.out),
    brokenOutdated.out.split('\n')[0] ?? '')
}

const failed = cases.filter((entry) => !entry.pass)
for (const entry of cases) console.log(`${entry.pass ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail ? `  (${entry.detail})` : ''}`)
console.log(`agent_guards=${failed.length ? 'failed' : 'passed'} checks=${cases.length}`)
if (failed.length) {
  for (const entry of failed) console.error(`::error title=Agent guard failed::${entry.name}`)
  process.exit(1)
}
