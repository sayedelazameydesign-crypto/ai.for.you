import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const REPORT_SCRIPT = resolve(REPO_ROOT, 'scripts/maintenance-report.mjs')

interface ReportEntry {
  area: string
  name: string
  status: 'PASS' | 'FAIL' | 'NOT RUN'
  detail: string
}

interface ReportJson {
  generated: string
  results: ReportEntry[]
  counts: {
    PASS: number
    FAIL: number
    'NOT RUN': number
  }
}

let fixtureTemplateDir = ''

beforeAll(() => {
  fixtureTemplateDir = mkdtempSync(join(tmpdir(), 'celia-report-template-'))
  for (const rel of [
    'README.md',
    'SECURITY.md',
    'CHANGELOG.md',
    'package.json',
    'docs',
    'shared',
    'server',
    'src/lib',
    'supabase',
  ]) {
    cpSync(resolve(REPO_ROOT, rel), join(fixtureTemplateDir, rel), { recursive: true })
  }
})

afterAll(() => {
  if (fixtureTemplateDir) {
    rmSync(fixtureTemplateDir, { recursive: true, force: true })
  }
})

function runIsolatedReport(options: {
  withNodeModules?: boolean
  reuseQuality?: boolean
  npmShimBody?: string
  mutateWorkspace?: (dir: string) => void
  extraEnv?: Record<string, string>
}) {
  const {
    withNodeModules = true,
    reuseQuality = true,
    npmShimBody,
    mutateWorkspace,
    extraEnv = {},
  } = options

  const dir = mkdtempSync(join(tmpdir(), 'celia-report-case-'))
  const outDir = mkdtempSync(join(tmpdir(), 'celia-report-out-'))
  const jsonPath = join(outDir, 'report.json')

  try {
    cpSync(fixtureTemplateDir, dir, { recursive: true })
    if (mutateWorkspace) {
      mutateWorkspace(dir)
    }

    spawnSync('git', ['init', '-b', 'feature/report-test'], { cwd: dir, encoding: 'utf8' })
    spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' })
    spawnSync(
      'git',
      ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture'],
      { cwd: dir, encoding: 'utf8' },
    )

    // Created after git commit and ignored as untracked only if git sees files inside it;
    // empty directory is ignored by `git status --porcelain`, keeping working tree clean.
    if (withNodeModules) {
      mkdirSync(join(dir, 'node_modules'), { recursive: true })
    }

    let env: NodeJS.ProcessEnv = {
      ...process.env,
      PAGE_URL: '',
      API_BASE: '',
      GITHUB_STEP_SUMMARY: '',
      ...extraEnv,
    }

    if (npmShimBody !== undefined) {
      const binDir = mkdtempSync(join(tmpdir(), 'celia-report-bin-'))
      const npmPath = join(binDir, 'npm')
      writeFileSync(npmPath, `#!/usr/bin/env node\n${npmShimBody}\n`, 'utf8')
      chmodSync(npmPath, 0o755)
      env = { ...env, PATH: `${binDir}:${process.env.PATH ?? ''}` }
      try {
        const args = [REPORT_SCRIPT, '--json', jsonPath, ...(reuseQuality ? ['--reuse-quality'] : [])]
        const res = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' })
        const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as ReportJson
        return {
          exitCode: res.status,
          stdout: res.stdout ?? '',
          stderr: res.stderr ?? '',
          report: json,
          findCheck: (name: string) => json.results.find((entry) => entry.name === name),
        }
      } finally {
        rmSync(binDir, { recursive: true, force: true })
      }
    }

    const args = [REPORT_SCRIPT, '--json', jsonPath, ...(reuseQuality ? ['--reuse-quality'] : [])]
    const res = spawnSync(process.execPath, args, { cwd: dir, env, encoding: 'utf8' })
    const json = JSON.parse(readFileSync(jsonPath, 'utf8')) as ReportJson
    return {
      exitCode: res.status,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
      report: json,
      findCheck: (name: string) => json.results.find((entry) => entry.name === name),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
    rmSync(outDir, { recursive: true, force: true })
  }
}

describe('scripts/maintenance-report.mjs diagnostic & exit-code integrity', () => {
  it('reports PASS and exits 0 when all dependencies are current and SQL/docs/secrets checks pass', () => {
    const run = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.stdout.write('{}'); process.exit(0) }
        if (args[0] === 'outdated') { process.stdout.write('{}'); process.exit(0) }
        process.exit(0)
      `,
    })

    expect(run.exitCode).toBe(0)
    expect(run.report.counts.FAIL).toBe(0)
    expect(run.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'PASS',
      detail: 'all dependencies current',
    })
    expect(run.findCheck('quota SQL policy')).toEqual({
      area: 'security',
      name: 'quota SQL policy',
      status: 'PASS',
      detail: 'sql_check=passed files=1',
    })
    expect(run.findCheck('live site smoke test')?.status).toBe('NOT RUN')
  })

  it('separates stdout from stderr so npm warnings on stderr do not corrupt valid outdated JSON', () => {
    const run = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stderr.write('npm notice New major version of npm available!\\nnpm WARN config global\\n')
          process.stdout.write(JSON.stringify({
            vite: { current: '8.3.6', wanted: '8.3.7', latest: '8.3.7' },
            typescript: { current: '5.9.3', wanted: '5.9.3', latest: '7.0.2' },
          }))
          process.exit(1)
        }
        process.exit(0)
      `,
    })

    expect(run.exitCode).toBe(0)
    expect(run.report.counts.FAIL).toBe(0)
    expect(run.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'PASS',
      detail: '2 package(s) behind (1 routine, 1 major/range-pinned); reported, never auto-applied',
    })
  })

  it('fails with reason=npm_outdated_error (ENEEDAUTH) and exits 1 when registry credentials are rejected', () => {
    const run = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stderr.write('npm error code ENEEDAUTH\\n')
          process.stdout.write(JSON.stringify({
            error: { code: 'ENEEDAUTH', summary: 'This command requires you to be logged in.' },
          }))
          process.exit(1)
        }
        process.exit(0)
      `,
    })

    expect(run.exitCode).toBe(1)
    expect(run.report.counts.FAIL).toBe(1)
    expect(run.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'FAIL',
      detail: 'reason=npm_outdated_error (ENEEDAUTH)',
    })
  })

  it('fails with reason=outdated_parse_failed and exits 1 when npm outdated outputs corrupt JSON', () => {
    const run = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stdout.write('{"vite": {corrupt-json')
          process.exit(1)
        }
        process.exit(0)
      `,
    })

    expect(run.exitCode).toBe(1)
    expect(run.report.counts.FAIL).toBe(1)
    expect(run.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'FAIL',
      detail: 'reason=outdated_parse_failed',
    })
  })

  it('fails with reason=outdated_command_failed and exits 1 when npm outdated exits non-zero without package entries', () => {
    const emptyStdoutFailure = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stderr.write('npm ERR! unexpected internal error\\n')
          process.exit(2)
        }
        process.exit(0)
      `,
    })

    expect(emptyStdoutFailure.exitCode).toBe(1)
    expect(emptyStdoutFailure.report.counts.FAIL).toBe(1)
    expect(emptyStdoutFailure.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'FAIL',
      detail: 'reason=outdated_command_failed (exit=2)',
    })

    const emptyJsonNonZero = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stdout.write('{}')
          process.exit(1)
        }
        process.exit(0)
      `,
    })

    expect(emptyJsonNonZero.exitCode).toBe(1)
    expect(emptyJsonNonZero.findCheck('outdated packages')?.status).toBe('FAIL')
    expect(emptyJsonNonZero.findCheck('outdated packages')?.detail).toBe('reason=outdated_command_failed (exit=1)')
  })

  it('fails with reason=missing_installed_version and exits 1 when npm outdated omits current', () => {
    const run = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stdout.write(JSON.stringify({
            vite: { wanted: '8.3.6', latest: '8.4.0' },
          }))
          process.exit(1)
        }
        process.exit(0)
      `,
    })

    expect(run.exitCode).toBe(1)
    expect(run.report.counts.FAIL).toBe(1)
    expect(run.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'FAIL',
      detail: 'reason=missing_installed_version (vite)',
    })
  })

  it('fails with reason=network_error and exits 1 on DNS, timeout and real ECONNREFUSED registry errors', () => {
    const dnsFailure = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stderr.write('npm error code ENOTFOUND\\n')
          process.stdout.write(JSON.stringify({
            error: { code: 'ENOTFOUND', summary: 'getaddrinfo ENOTFOUND registry.npmjs.org' },
          }))
          process.exit(1)
        }
        process.exit(0)
      `,
    })
    expect(dnsFailure.exitCode).toBe(1)
    expect(dnsFailure.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'FAIL',
      detail: 'reason=network_error (ENOTFOUND)',
    })

    const stderrTimeout = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') {
          process.stderr.write('npm ERR! network timeout ETIMEDOUT\\n')
          process.exit(1)
        }
        process.exit(0)
      `,
    })
    expect(stderrTimeout.exitCode).toBe(1)
    expect(stderrTimeout.findCheck('outdated packages')?.detail).toBe('reason=network_error (ETIMEDOUT)')

    // Exercise the real npm CLI against an unreachable local port (no npm shim).
    const realConnRefused = runIsolatedReport({
      extraEnv: {
        npm_config_registry: 'http://127.0.0.1:1',
        npm_config_fetch_retries: '0',
      },
    })
    expect(realConnRefused.exitCode).toBe(1)
    expect(realConnRefused.findCheck('outdated packages')).toEqual({
      area: 'dependencies',
      name: 'outdated packages',
      status: 'FAIL',
      detail: 'reason=network_error (ECONNREFUSED)',
    })
  })

  it('records NOT RUN (never PASS) for test and dependency checks when node_modules is missing', () => {
    const run = runIsolatedReport({
      withNodeModules: false,
      reuseQuality: false,
    })

    expect(run.exitCode).toBe(0)
    expect(run.report.counts.FAIL).toBe(0)
    expect(run.findCheck('lint + unit tests + build')?.status).toBe('NOT RUN')
    expect(run.findCheck('coverage thresholds')?.status).toBe('NOT RUN')
    expect(run.findCheck('high-severity audit')?.status).toBe('NOT RUN')
    expect(run.findCheck('outdated packages')?.status).toBe('NOT RUN')
  })

  it('executes real check-sql.mjs against a policy-violating SQL migration and exits 1', () => {
    const mutableSearchPathRun = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') { process.stdout.write('{}'); process.exit(0) }
        process.exit(0)
      `,
      mutateWorkspace: (dir) => {
        const sqlPath = join(dir, 'supabase/migrations/0001_entitlements.sql')
        const original = readFileSync(sqlPath, 'utf8')
        writeFileSync(sqlPath, original.replace("set search_path = ''", 'set search_path = public'), 'utf8')
      },
    })

    expect(mutableSearchPathRun.exitCode).toBe(1)
    expect(mutableSearchPathRun.report.counts.FAIL).toBe(1)
    expect(mutableSearchPathRun.findCheck('quota SQL policy')).toEqual({
      area: 'security',
      name: 'quota SQL policy',
      status: 'FAIL',
      detail: 'reason=definer_mutable_search_path',
    })

    const clientWriteRun = runIsolatedReport({
      npmShimBody: `
        const args = process.argv.slice(2)
        if (args[0] === 'audit') { process.exit(0) }
        if (args[0] === 'outdated') { process.stdout.write('{}'); process.exit(0) }
        process.exit(0)
      `,
      mutateWorkspace: (dir) => {
        const sqlPath = join(dir, 'supabase/migrations/0001_entitlements.sql')
        const original = readFileSync(sqlPath, 'utf8')
        writeFileSync(sqlPath, `${original}\ngrant update on table public.accounts to authenticated;\n`, 'utf8')
      },
    })

    expect(clientWriteRun.exitCode).toBe(1)
    expect(clientWriteRun.report.counts.FAIL).toBe(1)
    expect(clientWriteRun.findCheck('quota SQL policy')).toEqual({
      area: 'security',
      name: 'quota SQL policy',
      status: 'FAIL',
      detail: 'reason=client_can_write',
    })
  })
})
