import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const AGENT_SCRIPT = resolve(process.cwd(), 'scripts/maintenance-agent.mjs')

interface IsolatedRepo {
  rootDir: string
  remoteDir: string
  workDir: string
  baseMainSha: string
  cleanup: () => void
}

function git(cwd: string, args: string[]) {
  const res = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Celia Test',
      GIT_AUTHOR_EMAIL: 'test@celia.invalid',
      GIT_COMMITTER_NAME: 'Celia Test',
      GIT_COMMITTER_EMAIL: 'test@celia.invalid',
    },
  })
  if (res.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed (${res.status}): ${res.stderr || res.stdout}`)
  }
  return res.stdout.trim()
}

/**
 * Creates a real bare `origin` repository initialized on `main`, populates an
 * initial commit, and clones `workDir` with `--depth=1 --single-branch --branch main`
 * to match `actions/checkout` on scheduled GitHub Actions runs.
 */
function createIsolatedMainCheckout(options?: {
  checkScriptExit?: number
  precreateRemoteProposalBranch?: string
}): IsolatedRepo {
  const rootDir = mkdtempSync(join(tmpdir(), 'celia-p1-agent-'))
  const remoteDir = join(rootDir, 'origin.git')
  const seedDir = join(rootDir, 'seed')
  const workDir = join(rootDir, 'work')

  try {
    git(rootDir, ['init', '--bare', '-b', 'main', remoteDir])
    git(rootDir, ['clone', `file://${remoteDir}`, seedDir])

    writeFileSync(
      join(seedDir, '.gitignore'),
      'node_modules/\nbin/\n',
      'utf8',
    )
    writeFileSync(
      join(seedDir, 'package.json'),
      JSON.stringify(
        {
          name: 'celia-agent-fixture',
          version: '0.1.0',
          scripts: {
            check: `node -e "process.exit(${options?.checkScriptExit ?? 0})"`,
          },
          dependencies: {
            vite: '^8.0.8',
          },
          devDependencies: {
            typescript: '^5.9.3',
          },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
    writeFileSync(
      join(seedDir, 'package-lock.json'),
      JSON.stringify(
        {
          name: 'celia-agent-fixture',
          version: '0.1.0',
          lockfileVersion: 3,
          packages: {
            '': {
              name: 'celia-agent-fixture',
              version: '0.1.0',
              dependencies: { vite: '^8.0.8' },
              devDependencies: { typescript: '^5.9.3' },
            },
            'node_modules/vite': { version: '8.0.8' },
            'node_modules/typescript': { version: '5.9.3' },
          },
        },
        null,
        2,
      ) + '\n',
      'utf8',
    )
    writeFileSync(
      join(seedDir, 'CHANGELOG.md'),
      '# سجل التغييرات\n\n## [Unreleased]\n\n### أُضيف\n- تهيئة أولية.\n',
      'utf8',
    )

    git(seedDir, ['add', '.'])
    git(seedDir, ['commit', '-m', 'Initial commit on main'])
    git(seedDir, ['push', 'origin', 'main'])

    if (options?.precreateRemoteProposalBranch) {
      const propBranch = options.precreateRemoteProposalBranch
      git(seedDir, ['checkout', '-b', propBranch])
      writeFileSync(join(seedDir, 'CHANGELOG.md'), '# سجل التغييرات\n\n## [Unreleased]\n\n- اقتراح قديم.\n', 'utf8')
      git(seedDir, ['add', 'CHANGELOG.md'])
      git(seedDir, ['commit', '-m', 'Stale proposal on old main'])
      git(seedDir, ['push', 'origin', propBranch])

      // Advance `main` ahead of the stale proposal branch so we prove the agent
      // recreates the proposal branch from the latest `main` commit, not stale history.
      git(seedDir, ['checkout', 'main'])
      writeFileSync(
        join(seedDir, 'CHANGELOG.md'),
        '# سجل التغييرات\n\n## [Unreleased]\n\n### أُصلح\n- التزام أحدث على main.\n',
        'utf8',
      )
      git(seedDir, ['add', 'CHANGELOG.md'])
      git(seedDir, ['commit', '-m', 'Advance main ahead of stale proposal'])
      git(seedDir, ['push', 'origin', 'main'])
    }

    git(rootDir, ['clone', '--depth=1', '--single-branch', '--branch', 'main', `file://${remoteDir}`, workDir])
    mkdirSync(join(workDir, 'node_modules', 'vite'), { recursive: true })
    mkdirSync(join(workDir, 'node_modules', 'typescript'), { recursive: true })

    const baseMainSha = git(workDir, ['rev-parse', 'HEAD'])

    return {
      rootDir,
      remoteDir,
      workDir,
      baseMainSha,
      cleanup: () => rmSync(rootDir, { recursive: true, force: true }),
    }
  } catch (err) {
    rmSync(rootDir, { recursive: true, force: true })
    throw err
  }
}

function installNpmShim(workDir: string, scriptSource: string): NodeJS.ProcessEnv {
  const binDir = join(workDir, 'bin')
  const emptyHome = join(workDir, '..', 'empty-home')
  mkdirSync(binDir, { recursive: true })
  mkdirSync(emptyHome, { recursive: true })
  const shimPath = join(binDir, 'npm')
  writeFileSync(shimPath, `#!/usr/bin/env node\n${scriptSource}\n`, 'utf8')
  chmodSync(shimPath, 0o755)
  const cleanEnv: NodeJS.ProcessEnv = { ...process.env }
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

function runAgent(workDir: string, agentArgs: string[], env: NodeJS.ProcessEnv) {
  const res = spawnSync(process.execPath, [AGENT_SCRIPT, ...agentArgs], {
    cwd: workDir,
    env,
    encoding: 'utf8',
  })
  return {
    status: res.status ?? -1,
    stdout: (res.stdout ?? '').trim(),
    stderr: (res.stderr ?? '').trim(),
  }
}

const ROUTINE_UPDATE_NPM_SHIM = `
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);

if (args[0] === 'outdated') {
  process.stdout.write(JSON.stringify({
    vite: { current: '8.0.8', wanted: '8.0.9', latest: '8.0.9' },
    typescript: { current: '5.9.3', wanted: '5.9.3', latest: '7.0.2' },
  }));
  process.exit(1);
}

if (args[0] === 'update') {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  pkg.dependencies.vite = '^8.0.9';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\\n');
  const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
  lock.packages['node_modules/vite'].version = '8.0.9';
  fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\\n');
  process.exit(0);
}

if (args[0] === 'run' && args[1] === 'check') {
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const cmd = pkg.scripts && pkg.scripts.check;
  if (!cmd) process.exit(0);
  const res = spawnSync('sh', ['-c', cmd], { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

process.exit(0);
`

describe('P1 (G12) — scripts/maintenance-agent.mjs protected-branch recovery & safety invariants', () => {
  it('1. main without routine updates exits 0 as NOOP without creating a branch or touching main (Run 42624824040 / Issue #11 fix)', () => {
    const repo = createIsolatedMainCheckout()
    try {
      const env = installNpmShim(
        repo.workDir,
        `const args = process.argv.slice(2);
if (args[0] === 'outdated') {
  process.stdout.write(JSON.stringify({
    typescript: { current: '5.9.3', wanted: '5.9.3', latest: '7.0.2' },
    react: { current: '18.3.1', wanted: '19.0.0', latest: '19.2.0' },
  }));
  process.exit(1);
}
process.exit(0);`,
      )

      const res = runAgent(repo.workDir, ['--apply'], env)
      expect(res.status).toBe(0)
      expect(res.stdout).toContain('agent=observe branch=main outdated_total=2 routine=0 major_skipped=1 range_satisfied=1')
      expect(res.stdout).toContain('agent=noop reason=no_routine_updates_available branch=main major_skipped=1 range_satisfied=1')
      expect(res.stdout).not.toContain('reason=protected_branch')
      expect(res.stdout).not.toContain('agent=proposed')

      expect(git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['branch', '--list', 'maintenance/*'])).toBe('')
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')
    } finally {
      repo.cleanup()
    }
  })

  it('2. main with routine updates isolates changes onto maintenance/* from main, passes gates, pushes proposal only, and leaves main untouched', () => {
    const repo = createIsolatedMainCheckout()
    try {
      const env = installNpmShim(repo.workDir, ROUTINE_UPDATE_NPM_SHIM)

      const applyRes = runAgent(repo.workDir, ['--apply'], env)
      expect(applyRes.status).toBe(0)
      expect(applyRes.stdout).toContain('agent=observe branch=main outdated_total=2 routine=1 major_skipped=0 range_satisfied=1')
      expect(applyRes.stdout).toMatch(/agent=proposed branch=maintenance\/routine-dependencies-\d{4}-\d{2}-\d{2}/)
      expect(applyRes.stdout).toContain('agent=merge_blocked_by_design reason=human_approval_required')

      const activeBranch = git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])
      expect(activeBranch).toMatch(/^maintenance\/routine-dependencies-\d{4}-\d{2}-\d{2}$/)
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['rev-parse', 'HEAD~1'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')

      const updatedPkg = JSON.parse(readFileSync(join(repo.workDir, 'package.json'), 'utf8'))
      expect(updatedPkg.dependencies.vite).toBe('^8.0.9')
      expect(updatedPkg.devDependencies.typescript).toBe('^5.9.3')
      expect(readFileSync(join(repo.workDir, 'CHANGELOG.md'), 'utf8')).toContain('vite 8.0.8 → 8.0.9')

      const pushRes = runAgent(repo.workDir, ['--push', activeBranch], env)
      expect(pushRes.status).toBe(0)
      expect(pushRes.stdout).toContain(`agent=pushed branch=${activeBranch} lease=new`)

      const proposalSha = git(repo.workDir, ['rev-parse', 'HEAD'])
      expect(git(repo.remoteDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.remoteDir, ['rev-parse', `refs/heads/${activeBranch}`])).toBe(proposalSha)
    } finally {
      repo.cleanup()
    }
  })

  it('3. dirty working tree (modified tracked file or untracked file) blocks --apply with exit 1 without branching or committing', () => {
    const repo = createIsolatedMainCheckout()
    try {
      const env = installNpmShim(repo.workDir, ROUTINE_UPDATE_NPM_SHIM)

      // 3a: untracked file present on main
      writeFileSync(join(repo.workDir, 'scratch.txt'), 'uncommitted note\n', 'utf8')
      const untrackedRes = runAgent(repo.workDir, ['--apply'], env)
      expect(untrackedRes.status).toBe(1)
      expect(untrackedRes.stdout).toContain('agent=blocked reason=dirty_working_tree branch=main')
      expect(git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(git(repo.workDir, ['branch', '--list', 'maintenance/*'])).toBe('')
      rmSync(join(repo.workDir, 'scratch.txt'))

      // 3b: modified tracked file on main
      const origChangelog = readFileSync(join(repo.workDir, 'CHANGELOG.md'), 'utf8')
      writeFileSync(join(repo.workDir, 'CHANGELOG.md'), origChangelog + '\n- تعديل محلي غير ملتزم\n', 'utf8')
      const trackedDirtyRes = runAgent(repo.workDir, ['--apply'], env)
      expect(trackedDirtyRes.status).toBe(1)
      expect(trackedDirtyRes.stdout).toContain('agent=blocked reason=dirty_working_tree branch=main')
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['branch', '--list', 'maintenance/*'])).toBe('')
    } finally {
      repo.cleanup()
    }
  })

  it('4. pre-existing maintenance branch (local and remote) is cleanly recreated from latest main and force-with-lease pushed safely', () => {
    const proposalBranch = `maintenance/routine-dependencies-${new Date().toISOString().slice(0, 10)}`
    const repo = createIsolatedMainCheckout({ precreateRemoteProposalBranch: proposalBranch })
    try {
      const staleRemoteSha = git(repo.remoteDir, ['rev-parse', `refs/heads/${proposalBranch}`])
      expect(staleRemoteSha).not.toBe(repo.baseMainSha)

      // Also create a local pre-existing `maintenance/...` branch pointing at an older/diverged commit
      git(repo.workDir, ['checkout', '-b', proposalBranch])
      writeFileSync(join(repo.workDir, 'CHANGELOG.md'), '# stale local branch\n', 'utf8')
      git(repo.workDir, ['add', 'CHANGELOG.md'])
      git(repo.workDir, ['commit', '-m', 'Stale local maintenance commit'])
      const staleLocalSha = git(repo.workDir, ['rev-parse', 'HEAD'])
      git(repo.workDir, ['checkout', 'main'])

      const env = installNpmShim(repo.workDir, ROUTINE_UPDATE_NPM_SHIM)
      const applyRes = runAgent(repo.workDir, ['--apply'], env)
      expect(applyRes.status).toBe(0)
      expect(applyRes.stdout).toContain(`agent=proposed branch=${proposalBranch}`)
      expect(applyRes.stdout).toContain('preexisting_branch=true')

      const freshProposalSha = git(repo.workDir, ['rev-parse', 'HEAD'])
      expect(freshProposalSha).not.toBe(staleLocalSha)
      expect(git(repo.workDir, ['rev-parse', 'HEAD~1'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)

      // Push against single-branch shallow clone where remote already has `proposalBranch`
      const pushRes = runAgent(repo.workDir, ['--push', proposalBranch], env)
      expect(pushRes.status).toBe(0)
      expect(pushRes.stdout).toContain(`agent=pushed branch=${proposalBranch} lease=${staleRemoteSha}`)
      expect(git(repo.remoteDir, ['rev-parse', `refs/heads/${proposalBranch}`])).toBe(freshProposalSha)
      expect(git(repo.remoteDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
    } finally {
      repo.cleanup()
    }
  })

  it('5. branch creation failure exits 1 with reason=branch_failed and leaves main clean and untouched', () => {
    const repo = createIsolatedMainCheckout()
    try {
      // A branch named `maintenance` creates `refs/heads/maintenance` (a file), so real git
      // natively fails `checkout -B maintenance/routine-dependencies-...` with a ref D/F conflict.
      git(repo.workDir, ['branch', 'maintenance'])

      const env = installNpmShim(repo.workDir, ROUTINE_UPDATE_NPM_SHIM)
      const res = runAgent(repo.workDir, ['--apply'], env)

      expect(res.status).toBe(1)
      expect(res.stdout).toContain('agent=blocked reason=branch_failed')
      expect(git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')
    } finally {
      repo.cleanup()
    }
  })

  it('6. npm update failure rolls back partial manifest edits, restores main, removes unproposed branch, and exits 1', () => {
    const repo = createIsolatedMainCheckout()
    try {
      const env = installNpmShim(
        repo.workDir,
        `const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'outdated') {
  process.stdout.write(JSON.stringify({ vite: { current: '8.0.8', wanted: '8.0.9', latest: '8.0.9' } }));
  process.exit(1);
}
if (args[0] === 'update') {
  fs.writeFileSync('package.json', '{"corrupted": true}\\n');
  process.stderr.write('npm ERR! code EINTEGRITY\\n');
  process.exit(1);
}
process.exit(0);`,
      )

      const res = runAgent(repo.workDir, ['--apply'], env)
      expect(res.status).toBe(1)
      expect(res.stdout).toContain('agent=blocked reason=npm_update_failed')
      expect(git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['branch', '--list', 'maintenance/*'])).toBe('')
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')
      expect(JSON.parse(readFileSync(join(repo.workDir, 'package.json'), 'utf8')).dependencies.vite).toBe('^8.0.8')
    } finally {
      repo.cleanup()
    }
  })

  it('7. post-update test/check failure rolls back all changes, restores main without committing, and exits 1', () => {
    const repo = createIsolatedMainCheckout({ checkScriptExit: 1 })
    try {
      const env = installNpmShim(repo.workDir, ROUTINE_UPDATE_NPM_SHIM)

      const res = runAgent(repo.workDir, ['--apply'], env)
      expect(res.status).toBe(1)
      expect(res.stdout).toContain('agent=blocked reason=quality_failed_after_update')
      expect(res.stdout).not.toContain('agent=proposed')

      expect(git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['branch', '--list', 'maintenance/*'])).toBe('')
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')
    } finally {
      repo.cleanup()
    }
  })

  it('8. blocks every direct commit or push attempt targeting main/master or non-maintenance branches', () => {
    const repo = createIsolatedMainCheckout()
    try {
      const env = installNpmShim(repo.workDir, ROUTINE_UPDATE_NPM_SHIM)

      // 8a: explicit --proposal-branch=main / master / rogue branch rejected before mutation
      for (const badTarget of ['main', 'master', 'refs/heads/main']) {
        const res = runAgent(repo.workDir, ['--apply', `--proposal-branch=${badTarget}`], env)
        expect(res.status).toBe(1)
        expect(res.stdout).toContain('agent=blocked reason=protected_branch operation=apply')
      }
      const rogueBranchRes = runAgent(repo.workDir, ['--apply', '--proposal-branch=feature/not-maintenance'], env)
      expect(rogueBranchRes.status).toBe(1)
      expect(rogueBranchRes.stdout).toContain('agent=blocked reason=invalid_proposal_branch operation=apply')

      // 8b: --push blocked when targeting main, master, refs/heads/main, or when HEAD is on main
      for (const pushArgs of [['--push'], ['--push', 'main'], ['--push', 'master'], ['--push', 'refs/heads/main']]) {
        const pushRes = runAgent(repo.workDir, pushArgs, env)
        expect(pushRes.status).toBe(1)
        expect(pushRes.stdout).toContain('agent=blocked reason=protected_branch operation=push')
      }

      // 8c: defense-in-depth — even if a broken git `checkout -B` exits 0 while staying on `main`,
      // checkout verification halts with `protected_branch` before `npm update` or `git commit` runs.
      const realGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim()
      const gitShimPath = join(repo.workDir, 'bin', 'git')
      writeFileSync(
        gitShimPath,
        `#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
if (args[0] === 'checkout' && args[1] === '-B') {
  process.exit(0); // adversarial no-op leaving HEAD on main
}
const r = spawnSync(${JSON.stringify(realGit)}, args, { stdio: 'inherit' });
process.exit(r.status ?? 1);
`,
        'utf8',
      )
      chmodSync(gitShimPath, 0o755)

      const brokenCheckoutRes = runAgent(repo.workDir, ['--apply'], env)
      expect(brokenCheckoutRes.status).toBe(1)
      expect(brokenCheckoutRes.stdout).toContain('agent=blocked reason=protected_branch operation=checkout_verification branch=main')
      rmSync(gitShimPath)

      expect(git(repo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.remoteDir, ['rev-parse', 'refs/heads/main'])).toBe(repo.baseMainSha)
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')
    } finally {
      repo.cleanup()
    }
  })

  it('9. rolls back and blocks when npm update creates an unauthorized file outside ALLOWED_PATHS', () => {
    const repo = createIsolatedMainCheckout()
    try {
      const env = installNpmShim(
        repo.workDir,
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
  fs.mkdirSync('src', { recursive: true });
  fs.writeFileSync('src/injected.ts', 'export const pwn = true;\\n');
  process.exit(0);
}
process.exit(0);`,
      )

      const res = runAgent(repo.workDir, ['--apply'], env)
      expect(res.status).toBe(1)
      expect(res.stdout).toContain('agent=blocked reason=path_not_allowed files=src/injected.ts')
      expect(git(repo.workDir, ['rev-parse', '--abbrev-ref', 'HEAD'])).toBe('main')
      expect(git(repo.workDir, ['branch', '--list', 'maintenance/*'])).toBe('')
      expect(git(repo.workDir, ['status', '--porcelain'])).toBe('')
    } finally {
      repo.cleanup()
    }
  })

  it('10. executes the exact Propose step from .github/workflows/maintenance-agent.yml under bash -eo pipefail for NOOP, PROPOSED, and BLOCKED runs on main', () => {
    const workflowYaml = readFileSync(resolve(process.cwd(), '.github/workflows/maintenance-agent.yml'), 'utf8')
    const stepMatch = /- name: Propose routine updates[\s\S]*?run: \|\n((?: {10}.*\n?)+)/.exec(workflowYaml)
    expect(stepMatch).not.toBeNull()
    const rawStepScript = (stepMatch?.[1] ?? '')
      .split('\n')
      .map((line) => line.replace(/^ {10}/, ''))
      .join('\n')
      .replace('node scripts/maintenance-agent.mjs --apply', `${JSON.stringify(process.execPath)} ${JSON.stringify(AGENT_SCRIPT)} --apply`)

    // 10a: NOOP on main -> workflow step exits 0 with decision=noop & empty branch
    const noopRepo = createIsolatedMainCheckout()
    try {
      const ghOut = join(noopRepo.rootDir, 'gh-out-noop.txt')
      writeFileSync(ghOut, '', 'utf8')
      const env = {
        ...installNpmShim(noopRepo.workDir, `process.stdout.write('{}'); process.exit(0);`),
        GITHUB_OUTPUT: ghOut,
      }
      const res = spawnSync('bash', ['-eo', 'pipefail', '-c', rawStepScript], {
        cwd: noopRepo.workDir,
        env,
        encoding: 'utf8',
      })
      expect(res.status).toBe(0)
      const outputs = readFileSync(ghOut, 'utf8')
      expect(outputs).toContain('decision=noop\n')
      expect(outputs).toContain('branch=\n')
    } finally {
      noopRepo.cleanup()
    }

    // 10b: PROPOSED from main -> workflow step exits 0 with decision=proposed & branch=maintenance/...
    const propRepo = createIsolatedMainCheckout()
    try {
      const ghOut = join(propRepo.rootDir, 'gh-out-prop.txt')
      writeFileSync(ghOut, '', 'utf8')
      const env = {
        ...installNpmShim(propRepo.workDir, ROUTINE_UPDATE_NPM_SHIM),
        GITHUB_OUTPUT: ghOut,
      }
      const res = spawnSync('bash', ['-eo', 'pipefail', '-c', rawStepScript], {
        cwd: propRepo.workDir,
        env,
        encoding: 'utf8',
      })
      expect(res.status).toBe(0)
      const outputs = readFileSync(ghOut, 'utf8')
      expect(outputs).toContain('decision=proposed\n')
      expect(outputs).toMatch(/branch=maintenance\/routine-dependencies-\d{4}-\d{2}-\d{2}\n/)
      expect(git(propRepo.workDir, ['rev-parse', 'refs/heads/main'])).toBe(propRepo.baseMainSha)
    } finally {
      propRepo.cleanup()
    }

    // 10c: BLOCKED on main (dirty tree) -> workflow step exits 1 under pipefail and does not emit decision=proposed
    const blockedRepo = createIsolatedMainCheckout()
    try {
      const ghOut = join(blockedRepo.rootDir, 'gh-out-blocked.txt')
      writeFileSync(ghOut, '', 'utf8')
      writeFileSync(join(blockedRepo.workDir, 'dirty.tmp'), 'dirty\n', 'utf8')
      const env = {
        ...installNpmShim(blockedRepo.workDir, ROUTINE_UPDATE_NPM_SHIM),
        GITHUB_OUTPUT: ghOut,
      }
      const res = spawnSync('bash', ['-eo', 'pipefail', '-c', rawStepScript], {
        cwd: blockedRepo.workDir,
        env,
        encoding: 'utf8',
      })
      expect(res.status).toBe(1)
      expect(readFileSync(ghOut, 'utf8')).not.toContain('decision=proposed')
    } finally {
      blockedRepo.cleanup()
    }
  })
})
