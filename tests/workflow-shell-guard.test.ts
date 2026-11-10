import { spawn, spawnSync } from 'node:child_process'
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const REPO_ROOT = process.cwd()
const GUARD_SCRIPT = resolve(REPO_ROOT, 'scripts/agent-guards.mjs')
const SMOKE_SCRIPT = resolve(REPO_ROOT, 'scripts/smoke-deploy.mjs')
const AGENT_SCRIPT = resolve(REPO_ROOT, 'scripts/maintenance-agent.mjs')
const LIVE_WORKFLOWS_DIR = resolve(REPO_ROOT, '.github/workflows')

interface Violation {
  file: string
  line: number
  rule: string
  detail: string
}

interface ParsedWorkflowStep {
  index: number
  name: string
  id: string | null
  ifCondition: string | null
  continueOnError?: boolean
  hasRun: boolean
  run?: string
  explicitStepShell?: string | null
  effectiveShell?: string | null
  safePipefail?: boolean
  documentedException?: boolean
  hasPipeline?: boolean
  runnerCommand?: string
  runnerArgsTemplate?: string[]
}

interface WorkflowFileReport {
  ok: boolean
  file: string
  workflowDefaultShell: string | null
  stepsChecked: number
  pipelineStepsChecked: number
  violations: Violation[]
  parsedJobs: Record<
    string,
    {
      jobDefaultShell: string | null
      steps: ParsedWorkflowStep[]
    }
  >
}

interface AuditDirectoryResult {
  ok: boolean
  workflowsChecked: number
  stepsChecked: number
  pipelineStepsChecked: number
  violations: Violation[]
  files: Record<string, WorkflowFileReport>
}

function runWorkflowDirAudit(workflowsDir: string, options?: { requireStandard?: boolean }) {
  const args = [GUARD_SCRIPT, '--workflows-dir', workflowsDir, '--json']
  if (options?.requireStandard === false) {
    args.push('--no-require-standard')
  }
  const res = spawnSync(process.execPath, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
  const parsed = JSON.parse(res.stdout) as AuditDirectoryResult
  return {
    status: res.status ?? -1,
    report: parsed,
  }
}

function auditSingleWorkflowFixture(yamlContent: string, fileName = 'fixture.yml') {
  const dir = mkdtempSync(join(tmpdir(), 'celia-wf-guard-'))
  try {
    writeFileSync(join(dir, fileName), yamlContent, 'utf8')
    return runWorkflowDirAudit(dir, { requireStandard: false })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Executes a workflow `run:` step by writing its script to an isolated `.sh`
 * file and invoking the exact shell command/arguments resolved from the
 * workflow YAML (matching GitHub Actions `ScriptHandler.cs` `{0}` substitution).
 */
function executeResolvedStep(
  step: ParsedWorkflowStep,
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    scriptTransform?: (script: string) => string
    overrideArgsTemplate?: { command: string; args: string[] }
  },
) {
  const tempScriptDir = mkdtempSync(join(tmpdir(), 'celia-runner-step-'))
  const scriptFile = join(tempScriptDir, 'step.sh')
  try {
    const rawScript = step.run ?? ''
    const finalScript = options.scriptTransform ? options.scriptTransform(rawScript) : rawScript
    writeFileSync(scriptFile, finalScript + '\n', 'utf8')

    const command = options.overrideArgsTemplate?.command ?? step.runnerCommand ?? 'bash'
    const template = options.overrideArgsTemplate?.args ?? step.runnerArgsTemplate ?? ['-e', '{0}']
    const args = template.map((token) => (token === '{0}' ? scriptFile : token))

    const res = spawnSync(command, args, {
      cwd: options.cwd,
      env: options.env,
      encoding: 'utf8',
    })
    return {
      status: res.status ?? -1,
      stdout: res.stdout ?? '',
      stderr: res.stderr ?? '',
    }
  } finally {
    rmSync(tempScriptDir, { recursive: true, force: true })
  }
}

function executeResolvedStepAsync(
  step: ParsedWorkflowStep,
  options: {
    cwd: string
    env: NodeJS.ProcessEnv
    scriptTransform?: (script: string) => string
  },
): Promise<{ status: number; stdout: string; stderr: string }> {
  const tempScriptDir = mkdtempSync(join(tmpdir(), 'celia-runner-async-'))
  const scriptFile = join(tempScriptDir, 'step.sh')
  const rawScript = step.run ?? ''
  const finalScript = options.scriptTransform ? options.scriptTransform(rawScript) : rawScript
  writeFileSync(scriptFile, finalScript + '\n', 'utf8')

  const command = step.runnerCommand ?? 'bash'
  const template = step.runnerArgsTemplate ?? ['-e', '{0}']
  const args = template.map((token) => (token === '{0}' ? scriptFile : token))

  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', (err) => {
      rmSync(tempScriptDir, { recursive: true, force: true })
      rejectPromise(err)
    })
    child.once('close', (code) => {
      rmSync(tempScriptDir, { recursive: true, force: true })
      resolvePromise({ status: code ?? -1, stdout, stderr })
    })
  })
}

function startLocalSiteServer(
  handler: (reqUrl: string) => { status: number; headers?: Record<string, string>; body: string },
): Promise<{ server: Server; baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      const reply = handler(req.url ?? '/')
      res.writeHead(reply.status, {
        'content-type': 'text/html; charset=utf-8',
        ...reply.headers,
      })
      res.end(reply.body)
    })
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo
      const baseUrl = `http://127.0.0.1:${addr.port}/`
      resolvePromise({
        server,
        baseUrl,
        close: () =>
          new Promise<void>((done) => {
            server.close(() => done())
          }),
      })
    })
  })
}

function shellFixture(script: string, shell = 'bash') {
  return [
    'name: Adversarial shell fixture', 'on: push',
    'defaults: { run: { shell: bash } }',
    'jobs:', '  check:', '    runs-on: ubuntu-latest', '    steps:',
    '      # shell-guard-allow: Documented non-pipeline exception for regression testing',
    `      - shell: ${JSON.stringify(shell)}`, '        run: |',
    ...script.split('\n').map((line) => `          ${line}`),
  ].join('\n')
}

describe('PR #21 — fail-closed shell template and whole-script regression proofs', () => {
  it('rejects bash -c exit -e -o pipefail {0} through auditWorkflowYaml and never synthesizes an invocation', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    const shell = 'bash -c exit -e -o pipefail {0}'
    expect(guard.classifyShell(shell).safePipefail).toBe(false)
    expect(guard.resolveRunnerInvocation(shell, '/tmp/step.sh')).toBeNull()
    const report = guard.auditWorkflowYaml(shellFixture('exit 17 | tee out.txt', shell))
    expect(report.ok).toBe(false)
    expect(report.violations.map((v: Violation) => v.rule)).toContain('unprotected_bash_step_shell')
    expect(report.parsedJobs.check.steps[0].runnerCommand).toBeNull()
    // Reproduce the actual bypass independently: -c exit ignores the file.
    expect(spawnSync('bash', ['-c', 'exit', '-e', '-o', 'pipefail', '/no/such/script']).status).toBe(0)
  })

  it('jointly checks official runner built-ins, absolute paths and every approved Bash template with real execution', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    const dir = mkdtempSync(join(tmpdir(), 'celia-shell-parity-'))
    const scriptPath = join(dir, 'step.sh')
    try {
      writeFileSync(scriptPath, "printf 'executed\\n'\n(exit 17) | cat\nprintf 'masked\\n'\n")
      for (const shell of [
        'bash', 'bash --noprofile --norc -e -o pipefail {0}',
        'bash -eo pipefail {0}', 'bash -oe pipefail {0}', 'bash -euo pipefail {0}',
        'bash -eu -o pipefail {0}', 'bash -ue -o pipefail {0}',
        'bash -u -o errexit -o pipefail {0}',
        '/usr/bin/bash --noprofile --norc -e -o pipefail {0}',
        '/bin/bash -e -o pipefail {0}',
      ]) {
        const classified = guard.classifyShell(shell)
        const runner = guard.resolveRunnerInvocation(shell, scriptPath)
        expect(classified.safePipefail, shell).toBe(true)
        expect(runner, shell).not.toBeNull()
        const run = spawnSync(runner.command, runner.args, { encoding: 'utf8' })
        expect(run.status, shell).toBe(17)
        expect(run.stdout, shell).toBe('executed\n')
        expect(guard.auditWorkflowYaml(shellFixture('(exit 17) | cat', shell)).ok, shell).toBe(true)
      }
      expect(guard.resolveRunnerInvocation('bash', '/tmp/step with spaces.sh')).toBeNull()
      expect(guard.resolveRunnerInvocation('bash', '/tmp/step"quoted.sh')).toBeNull()
      expect(guard.resolveRunnerInvocation('bash', '{0}')).toEqual({
        command: 'bash', args: ['--noprofile', '--norc', '-e', '-o', 'pipefail', '{0}'],
      })
      for (const shell of [null, 'bash -e {0}', '/usr/bin/bash {0}']) {
        expect(guard.classifyShell(shell).safePipefail).toBe(false)
        const runner = guard.resolveRunnerInvocation(shell, scriptPath)
        expect(spawnSync(runner.command, runner.args).status).toBe(0)
      }
      expect(guard.resolveRunnerInvocation(null, '{0}')).toEqual({ command: 'bash', args: ['-e', '{0}'] })
      for (const [shell, command, args] of [
        ['sh', 'sh', ['-e', '{0}']], ['sh -e {0}', 'sh', ['-e', '{0}']],
        ['sh -eu {0}', 'sh', ['-eu', '{0}']],
        ['python', 'python', ['{0}']], ['python {0}', 'python', ['{0}']],
        ['python3 {0}', 'python3', ['{0}']], ['pwsh', 'pwsh', ['-command', ". '{0}'"]],
      ] as const) {
        expect(guard.classifyShell(shell)).toMatchObject({ safePipefail: false, allowException: true })
        expect(guard.resolveRunnerInvocation(shell, '{0}')).toEqual({ command, args })
      }
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('rejects unsupported options, misplaced placeholders, bare paths and unsafe exception templates consistently', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    for (const shell of [
      '/usr/bin/bash', '/bin/bash', 'python3', '/usr/bin/python',
      'bash -c exit -e -o pipefail {0}', '/usr/bin/bash -c exit -e -o pipefail {0}',
      'bash -e -o pipefail -- {0}', 'bash -e -o pipefail other {0}',
      'bash -e -o pipefail {0} extra', 'bash -e -o pipefail {0} {0}',
      'bash -e -o pipefail{0}', 'bash -e -o pipefail -s {0}',
      'bash -e -o pipefail +e {0}', 'bash -e --norc -o pipefail {0}', 'bash -e -o pipefail -O extglob {0}',
      'bash\t-e -o pipefail {0}', ' bash', 'bash  -e -o pipefail {0}',
      'sh -c exit {0}', 'sh -- {0}', 'python -c exit {0}', 'pwsh -command exit {0}',
    ]) {
      expect(guard.classifyShell(shell), shell).toMatchObject({ safePipefail: false, allowException: false })
      expect(guard.resolveRunnerInvocation(shell, '{0}'), shell).toBeNull()
      expect(guard.auditWorkflowYaml(shellFixture('echo ok', shell)).ok, shell).toBe(false)
    }
  })

  it('multiline quoted <<HIDE cannot hide set +o pipefail or the later pipeline', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    for (const quote of ['"', "'", "$'"]) {
      const close = quote === "$'" ? "'" : quote
      const script = `printf '%s\\n' ${quote}start\n<<HIDE\nend${close}\nset +o pipefail\nnode scripts/smoke-deploy.mjs | tee out.txt`
      expect(guard.analyzeShellScript(script)).toMatchObject({ hasPipeline: true, disablesSafety: true, ambiguous: false })
      const report = guard.auditWorkflowYaml(shellFixture(script))
      expect(report.ok).toBe(false)
      expect(report.parsedJobs.check.steps[0]).toMatchObject({ hasPipeline: true, disablesSafety: true })
      expect(report.violations.map((v: Violation) => v.rule)).toContain('script_disables_shell_safety')
      const shReport = guard.auditWorkflowYaml(shellFixture(script, 'sh'))
      expect(shReport.violations.map((v: Violation) => v.rule)).toContain('posix_sh_forbidden_on_pipeline')
    }
  })

  it('real heredoc literal bodies are not executable Bash and closing delimiters never swallow later commands', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    for (const delimiter of ['EOF', "'EOF'", '"EOF"', '\\EOF', "-'EOF'"]) {
      const tabs = delimiter.startsWith('-') ? '\t' : ''
      const script = `cat <<${delimiter}\n${tabs}set +o pipefail\n${tabs}false | tee literal.txt\n${tabs}EOF\necho ok`
      expect(guard.analyzeShellScript(script), delimiter).toMatchObject({ hasPipeline: false, disablesSafety: false, ambiguous: false })
      expect(guard.auditWorkflowYaml(shellFixture(script)).ok, delimiter).toBe(true)
      const after = guard.auditWorkflowYaml(shellFixture(`${script}\nset +e\nfalse | cat`))
      expect(after.ok).toBe(false)
      expect(after.parsedJobs.check.steps[0]).toMatchObject({ hasPipeline: true, disablesSafety: true })
    }
    const multiple = "cat <<'FIRST' <<'SECOND'\nset +e | cat\nFIRST\nset +e | cat\nSECOND\necho ok"
    expect(guard.auditWorkflowYaml(shellFixture(multiple)).ok).toBe(true)
    const literal = "cat <<'EOF'\n$(set +e; false | cat)\nEOF"
    expect(guard.analyzeShellScript(literal)).toMatchObject({ hasPipeline: false, disablesSafety: false, ambiguous: false })
  })

  it('recursively audits substitutions, escapes, quoted command words, comments and here-strings', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    for (const script of [
      'echo "$(set +o pipefail; false | cat)"',
      'echo "$(echo "$(set +e; false | cat)")"',
      'echo `set +e; false | cat`',
      'cat <<EOF\n$(set +e; false | cat)\nEOF',
      "se\"t\" '+o' 'pipefail'; false | cat",
      'set \\\n+o pipefail; false | cat',
      "set -x +o pipefail; false | cat",
    ]) {
      expect(guard.analyzeShellScript(script), script).toMatchObject({ hasPipeline: true, disablesSafety: true, ambiguous: false })
      expect(guard.auditWorkflowYaml(shellFixture(script)).ok, script).toBe(false)
    }
    for (const script of [
      'echo "start\n<<HIDE\nend" # <<COMMENT\ncat <<<"a | b"',
      'echo "escaped \\`literal\\` and \\"quote\\""',
      "printf '%s\\n' 'set +e | cat'", 'echo escaped\\|pipe',
      "printf '%s' $'line\\n<<NOT_A_HEREDOC'", '# <<EOF\necho ok || echo failure',
    ]) {
      expect(guard.analyzeShellScript(script), script).toMatchObject({ hasPipeline: false, disablesSafety: false, ambiguous: false })
    }
  })

  it('fails closed on unterminated quotes/substitutions/heredocs and dynamic or unsupported lexical constructs', async () => {
    const guard = await import(/* @vite-ignore */ GUARD_SCRIPT)
    for (const script of [
      "echo 'open", 'echo "open', "echo $'open", 'echo trailing\\',
      'echo "$(echo ok"', 'echo `echo ok', 'cat <<EOF\nnever closed',
      'cat <<$VAR\necho ok', 'cat <<$(echo EOF)\necho ok',
      'cat <<"$VAR"\necho ok', "cat <<'EOF'junk\necho ok",
      'cat <<EOF <<SECOND\nEOF\nmissing second',
      'cat <<EOF\nx\\\nEOF\necho ok\nEOF',
      'echo $((1 + 2))', 'cat <(echo ok)', 'echo "${value:-ok}"',
      'set "$OPTIONS"', 'eval "set +e"', 'source options.sh', 'echo $"translated"',
      "echo $'\\x73et'", 'echo "$(case x in x) echo ok;; esac)"', 'echo `echo \\`nested\\``',
    ]) {
      const report = guard.auditWorkflowYaml(shellFixture(script))
      expect(report.ok, script).toBe(false)
      expect(report.violations.map((v: Violation) => v.rule), script).toContain('ambiguous_shell_syntax')
    }
  })
})

describe('P1 — Workflow shell guard structural & override verification (scripts/agent-guards.mjs)', () => {
  it('1. accepts the live .github/workflows directory and passes all 30 checks in agent-guards.mjs', () => {
    const live = runWorkflowDirAudit(LIVE_WORKFLOWS_DIR, { requireStandard: true })
    expect(live.status).toBe(0)
    expect(live.report.ok).toBe(true)
    expect(live.report.workflowsChecked).toBe(4)
    expect(live.report.violations).toEqual([])

    for (const wf of ['ci.yml', 'maintenance-agent.yml', 'maintenance-report.yml', 'groq-smoke.yml']) {
      expect(live.report.files[wf]?.ok).toBe(true)
      expect(live.report.files[wf]?.workflowDefaultShell).toBe('bash')
    }

    const ciVerifySmoke = live.report.files['ci.yml'].parsedJobs.verify.steps.find(
      (s) => s.name === 'Smoke test the published site',
    )
    expect(ciVerifySmoke?.effectiveShell).toBe('bash')
    expect(ciVerifySmoke?.safePipefail).toBe(true)
    expect(ciVerifySmoke?.hasPipeline).toBe(true)
    expect(ciVerifySmoke?.runnerCommand).toBe('bash')
    expect(ciVerifySmoke?.runnerArgsTemplate).toEqual(['--noprofile', '--norc', '-e', '-o', 'pipefail', '{0}'])

    const maintPropose = live.report.files['maintenance-agent.yml'].parsedJobs.propose.steps.find(
      (s) => s.name === 'Propose routine updates',
    )
    expect(maintPropose?.effectiveShell).toBe('bash')
    expect(maintPropose?.safePipefail).toBe(true)
    expect(maintPropose?.hasPipeline).toBe(true)
    expect(maintPropose?.runnerArgsTemplate).toEqual(['--noprofile', '--norc', '-e', '-o', 'pipefail', '{0}'])

    // Explicit custom bash templates that include both -e and -o pipefail + {0} are also valid.
    const customSafeBash = auditSingleWorkflowFixture(
      [
        'name: Custom safe bash',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash --noprofile --norc -e -o pipefail {0}',
        'jobs:',
        '  build:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Explicit -eo pipefail step',
        '        shell: bash -eo pipefail {0}',
        '        run: echo "ok" | tee out.txt',
      ].join('\n'),
    )
    expect(customSafeBash.status).toBe(0)
    expect(customSafeBash.report.ok).toBe(true)

    const fullHarness = spawnSync(process.execPath, [GUARD_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    expect(fullHarness.status).toBe(0)
    expect(fullHarness.stdout).toContain('agent_guards=passed checks=30')
  })

  it('2. rejects workflows missing defaults.run.shell: bash (even with decoy comments/strings) or missing required workflow files', () => {
    const missingDefault = auditSingleWorkflowFixture(
      [
        'name: Missing workflow default',
        '# defaults:',
        '#   run:',
        '#     shell: bash',
        'on: push',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Decoy echo',
        '        run: |',
        '          echo "defaults: run: shell: bash" | tee summary.txt',
      ].join('\n'),
    )
    expect(missingDefault.status).toBe(1)
    expect(missingDefault.report.ok).toBe(false)
    expect(missingDefault.report.violations.map((v) => v.rule)).toContain('missing_workflow_default_shell')
    expect(missingDefault.report.violations.map((v) => v.rule)).toContain('step_effective_shell_unprotected')

    // Even if an individual step sets `shell: bash`, omitting workflow-level `defaults.run.shell` is rejected.
    const stepOnlyNoWorkflowDefault = auditSingleWorkflowFixture(
      [
        'name: Step shell without workflow default',
        'on: push',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - shell: bash',
        '        run: echo "ok"',
      ].join('\n'),
    )
    expect(stepOnlyNoWorkflowDefault.status).toBe(1)
    expect(stepOnlyNoWorkflowDefault.report.violations.map((v) => v.rule)).toContain('missing_workflow_default_shell')

    // Missing one of the 4 required workflow files in standard directory mode must fail.
    const incompleteDir = mkdtempSync(join(tmpdir(), 'celia-wf-missing-'))
    try {
      for (const wf of ['ci.yml', 'maintenance-report.yml', 'groq-smoke.yml']) {
        cpSync(join(LIVE_WORKFLOWS_DIR, wf), join(incompleteDir, wf))
      }
      const res = runWorkflowDirAudit(incompleteDir, { requireStandard: true })
      expect(res.status).toBe(1)
      expect(res.report.violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'maintenance-agent.yml',
            rule: 'missing_required_workflow',
          }),
        ]),
      )
    } finally {
      rmSync(incompleteDir, { recursive: true, force: true })
    }
  })

  it('3. rejects unsafe job-level and step-level shell overrides (sh, flow overrides, bash without pipefail, and in-script set +o pipefail)', () => {
    const jobOverrideBlock = auditSingleWorkflowFixture(
      [
        'name: Job sh override',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    defaults:',
        '      run:',
        '        shell: sh',
        '    steps:',
        '      - run: node scripts/smoke-deploy.mjs | tee out.txt',
      ].join('\n'),
    )
    expect(jobOverrideBlock.status).toBe(1)
    expect(jobOverrideBlock.report.violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining(['unsafe_job_shell_override', 'posix_sh_forbidden_on_pipeline']),
    )

    const jobOverrideFlow = auditSingleWorkflowFixture(
      [
        'name: Job flow override',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    defaults: { run: { shell: sh } }',
        '    steps:',
        '      - run: echo "check"',
      ].join('\n'),
    )
    expect(jobOverrideFlow.status).toBe(1)
    expect(jobOverrideFlow.report.violations.map((v) => v.rule)).toContain('unsafe_job_shell_override')

    // Sneaky `shell: bash -e {0}` (missing `-o pipefail`) or `shell: sh` placed AFTER `run: |` block scalar,
    // and in-script `set +o pipefail` must all be rejected — even if annotated with `# shell-guard-allow:`.
    const stepOverrides = auditSingleWorkflowFixture(
      [
        'name: Step overrides',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # shell-guard-allow: Trying to excuse bash without pipefail must still be rejected',
        '      - name: Bash without pipefail',
        '        shell: bash -e {0}',
        '        run: node scripts/smoke-deploy.mjs | tee out.txt',
        '      - name: Trailing sh override after block scalar',
        '        run: |',
        '          echo "hello"',
        '        shell: sh',
        '      - name: Disables pipefail inside script even after quoted/commented << tokens',
        '        run: |',
        '          echo "<<EOF" # <<COMMENT_EOF',
        '          cat <<<EOF',
        '          set +o pipefail',
        '          node scripts/smoke-deploy.mjs | tee out.txt',
        '      - { run: "node scripts/smoke-deploy.mjs | tee out.txt", shell: sh }',
      ].join('\n'),
    )
    expect(stepOverrides.status).toBe(1)
    expect(stepOverrides.report.violations.map((v) => v.rule)).toEqual(
      expect.arrayContaining([
        'unprotected_bash_step_shell',
        'unsafe_step_shell_override',
        'script_disables_shell_safety',
        'posix_sh_forbidden_on_pipeline',
      ]),
    )

    // Also verify quoted `<<EOF` does not hide a downstream pipeline under a documented `shell: sh` step.
    const quotedHeredocPipeBypass = auditSingleWorkflowFixture(
      [
        'name: Quoted heredoc decoy before pipe',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # shell-guard-allow: Attempting to hide a pipe behind a quoted <<EOF string',
        '      - name: Decoy heredoc string',
        '        shell: sh',
        '        run: |',
        '          echo "<<EOF"',
        '          node scripts/smoke-deploy.mjs | tee out.txt',
      ].join('\n'),
    )
    expect(quotedHeredocPipeBypass.status).toBe(1)
    expect(quotedHeredocPipeBypass.report.violations.map((v) => v.rule)).toContain('posix_sh_forbidden_on_pipeline')
  })

  it('4. accepts legitimate documented exceptions while rejecting empty justifications and blocking sh on pipelines', () => {
    const validDocumentedExceptions = auditSingleWorkflowFixture(
      [
        'name: Valid documented exceptions',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  mixed:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      - name: Normal bash pipeline',
        '        run: echo "ok" | tee out.txt',
        '      # shell-guard-allow: Inline Python JSON assertion step without shell pipelines',
        '      - name: Python validator',
        '        shell: python',
        '        run: |',
        '          import sys',
        '          sys.exit(0)',
        '      - name: PowerShell step',
        '        shell: pwsh # shell-guard-allow: Cross-platform PowerShell check with ErrorActionPreference stop',
        '        run: Write-Host "ok"',
        '      # shell-guard-allow: Single POSIX sh existence check with zero pipelines',
        '      - name: POSIX sh non-pipeline check',
        '        shell: sh',
        '        run: test -f package.json',
      ].join('\n'),
    )
    expect(validDocumentedExceptions.status).toBe(0)
    expect(validDocumentedExceptions.report.ok).toBe(true)
    const steps = validDocumentedExceptions.report.files['fixture.yml'].parsedJobs.mixed.steps
    expect(steps.filter((s) => s.documentedException).length).toBe(3)

    // Empty `# shell-guard-allow:` justification must fail.
    const emptyReason = auditSingleWorkflowFixture(
      [
        'name: Empty exception reason',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  check:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # shell-guard-allow:',
        '      - name: Unexplained python step',
        '        shell: python',
        '        run: print("hi")',
      ].join('\n'),
    )
    expect(emptyReason.status).toBe(1)
    expect(emptyReason.report.violations.map((v) => v.rule)).toContain('empty_exception_justification')

    // Even WITH a detailed `# shell-guard-allow:` comment, `shell: sh` on a pipeline is strictly forbidden.
    const shOnPipelineWithComment = auditSingleWorkflowFixture(
      [
        'name: Forbidden sh on pipeline',
        'on: push',
        'defaults:',
        '  run:',
        '    shell: bash',
        'jobs:',
        '  verify:',
        '    runs-on: ubuntu-latest',
        '    steps:',
        '      # shell-guard-allow: Attempting to allow POSIX sh on a tee pipeline',
        '      - name: Smoke with tee',
        '        shell: sh',
        '        run: node scripts/smoke-deploy.mjs "$PAGE_URL" | tee -a "$GITHUB_STEP_SUMMARY"',
      ].join('\n'),
    )
    expect(shOnPipelineWithComment.status).toBe(1)
    expect(shOnPipelineWithComment.report.violations.map((v) => v.rule)).toContain('posix_sh_forbidden_on_pipeline')
  })
})

describe('P2 — Practical behavioral execution proofs for pipeline failure propagation', () => {
  const liveAudit = runWorkflowDirAudit(LIVE_WORKFLOWS_DIR, { requireStandard: true }).report
  const ciVerifySteps = liveAudit.files['ci.yml'].parsedJobs.verify.steps.filter((s) => s.hasRun)
  const maintProposeSteps = liveAudit.files['maintenance-agent.yml'].parsedJobs.propose.steps.filter((s) => s.hasRun)

  it('1. primary command success + tee success produces overall success (exit 0) and writes tee output', () => {
    const dir = mkdtempSync(join(tmpdir(), 'celia-pipe-ok-'))
    try {
      const outFile = join(dir, 'summary.txt')
      const step: ParsedWorkflowStep = {
        ...ciVerifySteps[0],
        run: `node -e "console.log('smoke=ok'); process.exit(0)" | tee -a ${JSON.stringify(outFile)}`,
      }
      const res = executeResolvedStep(step, { cwd: dir, env: process.env })
      expect(res.status).toBe(0)
      expect(res.stdout.trim()).toBe('smoke=ok')
      expect(readFileSync(outFile, 'utf8').trim()).toBe('smoke=ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('2. primary command failure + tee success produces overall failure (unlike unconfigured bash -e {0})', () => {
    const dir = mkdtempSync(join(tmpdir(), 'celia-pipe-fail-'))
    try {
      const outFile = join(dir, 'summary.txt')
      const step: ParsedWorkflowStep = {
        ...ciVerifySteps[0],
        run: `node -e "console.log('partial_output'); process.exit(1)" | tee ${JSON.stringify(outFile)}`,
      }

      // Before fix (unconfigured Linux Actions default `bash -e {0}`): `tee` masks exit 1 -> status 0!
      const unconfigured = executeResolvedStep(step, {
        cwd: dir,
        env: process.env,
        overrideArgsTemplate: { command: 'bash', args: ['-e', '{0}'] },
      })
      expect(unconfigured.status).toBe(0)

      // After fix (workflow-resolved `bash --noprofile --norc -e -o pipefail {0}`): fails with status 1!
      const protectedRun = executeResolvedStep(step, { cwd: dir, env: process.env })
      expect(protectedRun.status).toBe(1)
      expect(readFileSync(outFile, 'utf8').trim()).toBe('partial_output')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('3. failure in an intermediate pipeline command is never hidden by upstream or downstream stages', () => {
    const dir = mkdtempSync(join(tmpdir(), 'celia-pipe-mid-'))
    try {
      const outFile = join(dir, 'out.txt')
      const step: ParsedWorkflowStep = {
        ...ciVerifySteps[0],
        run: [
          `node -e "console.log('line1\\nline2'); process.exit(0)"`,
          `node -e "process.stdin.resume(); process.stdin.on('end', () => { console.log('transformed'); process.exit(5); })"`,
          `tee ${JSON.stringify(outFile)}`,
        ].join(' | '),
      }
      const res = executeResolvedStep(step, { cwd: dir, env: process.env })
      expect(res.status).toBe(5)
      expect(readFileSync(outFile, 'utf8').trim()).toBe('transformed')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('4. preserves distinct non-zero exit codes across `| tee` and EXIT traps', () => {
    const dir = mkdtempSync(join(tmpdir(), 'celia-pipe-codes-'))
    try {
      for (const expectedCode of [2, 7, 23, 42]) {
        const step: ParsedWorkflowStep = {
          ...maintProposeSteps.find((s) => s.name === 'Propose routine updates')!,
          run: [
            'OUT_FILE="$(mktemp)"',
            'trap \'rm -f "$OUT_FILE"\' EXIT',
            `node -e "console.log('probe=${expectedCode}'); process.exit(${expectedCode})" | tee "$OUT_FILE"`,
            'echo "UNREACHABLE_AFTER_FAILED_PIPE"',
          ].join('\n'),
        }
        const res = executeResolvedStep(step, { cwd: dir, env: process.env })
        expect(res.status).toBe(expectedCode)
        expect(res.stdout).toContain(`probe=${expectedCode}`)
        expect(res.stdout).not.toContain('UNREACHABLE_AFTER_FAILED_PIPE')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('5. ci.yml verify job fails when smoke-deploy.mjs fails and executes "Report a failed deployment" (if: failure())', async () => {
    const smokeStep = ciVerifySteps.find((s) => s.name === 'Smoke test the published site')
    const reportFailureStep = ciVerifySteps.find((s) => s.name === 'Report a failed deployment')
    expect(smokeStep).toBeDefined()
    expect(reportFailureStep).toBeDefined()
    expect(reportFailureStep?.ifCondition).toBe('failure()')

    /**
     * Runs the actual `verify` job steps from `.github/workflows/ci.yml` in sequence,
     * evaluating `if: failure()` against prior step outcomes just like GitHub Actions.
     */
    const runVerifyJob = async (options: {
      cwd: string
      pageUrl: string
      smokeScriptPath?: string
      overrideArgsTemplate?: { command: string; args: string[] }
    }) => {
      const summaryFile = join(options.cwd, 'step-summary.md')
      writeFileSync(summaryFile, '', 'utf8')
      const targetSmoke = options.smokeScriptPath ?? SMOKE_SCRIPT
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PAGE_URL: options.pageUrl,
        API_BASE: '',
        SMOKE_STRICT_IDENTITY: '1',
        GITHUB_STEP_SUMMARY: summaryFile,
      }

      let jobFailed = false
      const executedSteps: string[] = []
      let smokeExitCode = -1

      for (const step of [smokeStep!, reportFailureStep!]) {
        if (step.ifCondition === 'failure()' && !jobFailed) {
          continue
        }
        executedSteps.push(step.name)
        const stepToRun: ParsedWorkflowStep = options.overrideArgsTemplate
          ? {
              ...step,
              runnerCommand: options.overrideArgsTemplate.command,
              runnerArgsTemplate: options.overrideArgsTemplate.args,
            }
          : step
        const res = await executeResolvedStepAsync(stepToRun, {
          cwd: options.cwd,
          env,
          scriptTransform: (s) =>
            s.replace('node scripts/smoke-deploy.mjs', `${JSON.stringify(process.execPath)} ${JSON.stringify(targetSmoke)}`),
        })
        if (step.name === 'Smoke test the published site') {
          smokeExitCode = res.status
        }
        if (res.status !== 0) {
          jobFailed = true
        }
      }

      return {
        jobOutcome: jobFailed ? 'failure' : 'success',
        smokeExitCode,
        executedSteps,
        summary: readFileSync(summaryFile, 'utf8'),
      }
    }

    const dir = mkdtempSync(join(tmpdir(), 'celia-verify-job-'))
    let siteServer: Awaited<ReturnType<typeof startLocalSiteServer>> | null = null
    try {
      // 5a: Healthy local HTTP site -> real `smoke-deploy.mjs` exits 0, `verify` succeeds, failure report skipped
      siteServer = await startLocalSiteServer(() => ({
        status: 200,
        body: [
          '<!doctype html>',
          '<html lang="ar" dir="rtl">',
          `<head><link rel="canonical" href="${siteServer!.baseUrl}" /></head>`,
          '<body><div id="root"></div><script type="module" src="/assets/index.js"></script></body>',
          '</html>',
        ].join(''),
      }))

      const healthyRun = await runVerifyJob({ cwd: dir, pageUrl: siteServer.baseUrl })
      expect(healthyRun.jobOutcome).toBe('success')
      expect(healthyRun.smokeExitCode).toBe(0)
      expect(healthyRun.executedSteps).toEqual(['Smoke test the published site'])
      expect(healthyRun.summary).toContain('deployment_smoke=passed')
      expect(healthyRun.summary).not.toContain('Rollback:')

      // 5b: Real `smoke-deploy.mjs` fails (invalid/missing PAGE_URL -> exit 1) -> `tee` cannot hide failure,
      // `verify` fails, and `Report a failed deployment` (`if: failure()`) executes!
      const invalidUrlRun = await runVerifyJob({ cwd: dir, pageUrl: 'not-a-valid-http-url' })
      expect(invalidUrlRun.jobOutcome).toBe('failure')
      expect(invalidUrlRun.smokeExitCode).toBe(1)
      expect(invalidUrlRun.executedSteps).toEqual([
        'Smoke test the published site',
        'Report a failed deployment',
      ])
      expect(invalidUrlRun.summary).toContain(
        'Rollback: git revert the offending merge, or re-run the previous successful deploy run.',
      )

      // 5c: Broken deployment streaming multi-line stdout into `tee -a "$GITHUB_STEP_SUMMARY"` before exiting 4 ->
      // `tee` writes diagnostic stdout AND exits 0, yet `verify` still fails with exit 4 and runs failure reporting!
      const failingSmokeShim = join(dir, 'failing-smoke.mjs')
      writeFileSync(
        failingSmokeShim,
        [
          `console.log('page_status=200 page=failed reason=missing_root attempts=5')`,
          `console.log('canonical=match')`,
          `console.error('deployment_smoke=failed page_reason=missing_root api_reason=skipped')`,
          `process.exit(4)`,
        ].join('\n'),
        'utf8',
      )

      const brokenSiteRun = await runVerifyJob({
        cwd: dir,
        pageUrl: siteServer.baseUrl,
        smokeScriptPath: failingSmokeShim,
      })
      expect(brokenSiteRun.jobOutcome).toBe('failure')
      expect(brokenSiteRun.smokeExitCode).toBe(4)
      expect(brokenSiteRun.executedSteps).toEqual([
        'Smoke test the published site',
        'Report a failed deployment',
      ])
      expect(brokenSiteRun.summary).toContain('page_status=200 page=failed reason=missing_root attempts=5')
      expect(brokenSiteRun.summary).toContain(
        'Rollback: git revert the offending merge, or re-run the previous successful deploy run.',
      )

      // 5d: Contrast with pre-fix unconfigured `bash -e {0}`: the exact same failing smoke check was masked by `tee`,
      // falsely reporting `jobOutcome=success` and skipping `Report a failed deployment`.
      const preFixFalseGreen = await runVerifyJob({
        cwd: dir,
        pageUrl: siteServer.baseUrl,
        smokeScriptPath: failingSmokeShim,
        overrideArgsTemplate: { command: 'bash', args: ['-e', '{0}'] },
      })
      expect(preFixFalseGreen.jobOutcome).toBe('success')
      expect(preFixFalseGreen.smokeExitCode).toBe(0)
      expect(preFixFalseGreen.executedSteps).toEqual(['Smoke test the published site'])
      expect(preFixFalseGreen.summary).not.toContain('Rollback:')
    } finally {
      if (siteServer) await siteServer.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('6. maintenance-agent.yml Propose step never declares success when maintenance-agent.mjs fails through `| tee`', () => {
    const proposeStep = maintProposeSteps.find((s) => s.name === 'Propose routine updates')
    const reportBlockedStep = maintProposeSteps.find((s) => s.name === 'Report a blocked proposal')
    expect(proposeStep).toBeDefined()
    expect(reportBlockedStep?.ifCondition).toBe('failure()')

    // 6a: Real `scripts/maintenance-agent.mjs --apply` failing on a dirty `main` repository
    const repoDir = mkdtempSync(join(tmpdir(), 'celia-maint-pipe-'))
    try {
      spawnSync('git', ['init', '-b', 'main'], { cwd: repoDir, encoding: 'utf8' })
      writeFileSync(join(repoDir, '.gitignore'), 'node_modules/\nbin/\n', 'utf8')
      writeFileSync(
        join(repoDir, 'package.json'),
        JSON.stringify({ name: 'maint-pipe-fixture', version: '0.1.0', dependencies: { vite: '^8.0.8' } }, null, 2) + '\n',
        'utf8',
      )
      spawnSync('git', ['add', '.'], { cwd: repoDir, encoding: 'utf8' })
      spawnSync(
        'git',
        ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'init'],
        { cwd: repoDir, encoding: 'utf8' },
      )
      const baseMainSha = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim()

      mkdirSync(join(repoDir, 'node_modules', 'vite'), { recursive: true })
      const binDir = join(repoDir, 'bin')
      mkdirSync(binDir, { recursive: true })
      const npmShim = join(binDir, 'npm')
      writeFileSync(
        npmShim,
        `#!/usr/bin/env node\nprocess.stdout.write(JSON.stringify({ vite: { current: '8.0.8', wanted: '8.0.9', latest: '8.0.9' } })); process.exit(1);\n`,
        'utf8',
      )
      chmodSync(npmShim, 0o755)

      // Dirty untracked file forces `maintenance-agent.mjs --apply` to exit 1 (`dirty_working_tree`)
      writeFileSync(join(repoDir, 'untracked-blocker.txt'), 'dirty\n', 'utf8')
      const ghOutput = join(repoDir, 'gh-output.txt')
      writeFileSync(ghOutput, '', 'utf8')

      const realAgentRes = executeResolvedStep(proposeStep!, {
        cwd: repoDir,
        env: {
          ...process.env,
          APPLY: 'true',
          PATH: `${binDir}:${process.env.PATH ?? ''}`,
          GITHUB_OUTPUT: ghOutput,
        },
        scriptTransform: (s) =>
          s.replace(
            'node scripts/maintenance-agent.mjs --apply',
            `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT_SCRIPT)} --apply`,
          ),
      })

      expect(realAgentRes.status).toBe(1)
      expect(realAgentRes.stdout).toContain('agent=blocked reason=dirty_working_tree')
      expect(readFileSync(ghOutput, 'utf8')).toBe('')
      expect(spawnSync('git', ['rev-parse', 'refs/heads/main'], { cwd: repoDir, encoding: 'utf8' }).stdout.trim()).toBe(
        baseMainSha,
      )

      // 6b: Adversarial crash after emitting `agent=proposed ...` with exit code 7:
      // Under old `bash -e {0}` without `pipefail`, `tee` returned 0 and `grep '^agent=proposed '` could be reached!
      // Under `maintenance-agent.yml`'s effective `bash --noprofile --norc -e -o pipefail {0}`, it aborts right at
      // the pipe with exact exit code 7 and writes nothing to `$GITHUB_OUTPUT`!
      rmSync(join(repoDir, 'untracked-blocker.txt'))
      const crashingAgent = join(binDir, 'crashing-agent.mjs')
      writeFileSync(
        crashingAgent,
        [
          `import { spawnSync } from 'node:child_process'`,
          `spawnSync('git', ['checkout', '-B', 'maintenance/routine-dependencies-2026-11-08'], { stdio: 'ignore' })`,
          `spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@e.invalid', 'commit', '--allow-empty', '-m', 'partial'], { stdio: 'ignore' })`,
          `console.log('agent=proposed branch=maintenance/routine-dependencies-2026-11-08 packages=vite')`,
          `process.exit(7)`,
        ].join('\n'),
        'utf8',
      )

      const crashOutProtected = join(repoDir, 'gh-out-protected.txt')
      writeFileSync(crashOutProtected, '', 'utf8')
      const protectedCrashRes = executeResolvedStep(proposeStep!, {
        cwd: repoDir,
        env: { ...process.env, GITHUB_OUTPUT: crashOutProtected },
        scriptTransform: (s) =>
          s.replace(
            'node scripts/maintenance-agent.mjs --apply',
            `${JSON.stringify(process.execPath)} ${JSON.stringify(crashingAgent)}`,
          ),
      })
      expect(protectedCrashRes.status).toBe(7)
      expect(readFileSync(crashOutProtected, 'utf8')).toBe('')

      // Contrast: prove that without `-o pipefail` (`bash -e {0}`), that exact crash would have falsely exited 0 with `decision=proposed`!
      spawnSync('git', ['checkout', 'main'], { cwd: repoDir, encoding: 'utf8' })
      const crashOutUnprotected = join(repoDir, 'gh-out-unprotected.txt')
      writeFileSync(crashOutUnprotected, '', 'utf8')
      const unprotectedCrashRes = executeResolvedStep(proposeStep!, {
        cwd: repoDir,
        env: { ...process.env, GITHUB_OUTPUT: crashOutUnprotected },
        overrideArgsTemplate: { command: 'bash', args: ['-e', '{0}'] },
        scriptTransform: (s) =>
          s.replace(
            'node scripts/maintenance-agent.mjs --apply',
            `${JSON.stringify(process.execPath)} ${JSON.stringify(crashingAgent)}`,
          ),
      })
      expect(unprotectedCrashRes.status).toBe(0)
      expect(readFileSync(crashOutUnprotected, 'utf8')).toContain('decision=proposed')
    } finally {
      rmSync(repoDir, { recursive: true, force: true })
    }
  })
})
