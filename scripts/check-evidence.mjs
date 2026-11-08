#!/usr/bin/env node
/**
 * Evidence gate: every published number must match a measurement.
 *
 * The failure mode this prevents is the one that hit this repository during the
 * audit: a document said "66 tests", then said "90 tests" after a fix, and the
 * only thing keeping those honest was a person remembering to edit a sentence.
 * Worse, the browser suite is described as "5 scenarios" in one place and is
 * actually 10 — a claim nobody had checked because nothing checked it.
 *
 * So the rule is mechanical: a claim in a document is written in a machine
 * readable row, and this script measures the same thing and compares. A wrong
 * number fails the build. A number that cannot be measured is reported as
 * NOT RUN and is excluded from the pass, never counted as correct.
 *
 * Claims live in docs/EVIDENCE.md as:
 *   | claim-id | kind | value | source-file |
 *
 * Usage:
 *   node scripts/check-evidence.mjs          # cheap checks only
 *   node scripts/check-evidence.mjs --full   # also runs the suites
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'

const FULL = process.argv.includes('--full')
const DOC = 'docs/EVIDENCE.md'

const rows = []
const report = (id, kind, claimed, actual, status, detail) => rows.push({ id, kind, claimed, actual, status, detail })

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 })
  return { ok: result.status === 0, out: `${result.stdout ?? ''}${result.stderr ?? ''}`, status: result.status ?? -1 }
}

/* ---------- Measurements, each returning a number or null ---------- */

const measurements = {
  /** Unit and integration test count, from the runner itself. */
  'tests:unit': () => {
    if (!FULL) return null
    run('npx', ['vitest', 'run', '--reporter=json', '--outputFile=/tmp/vitest.json'])
    if (!existsSync('/tmp/vitest.json')) return null
    try {
      const data = JSON.parse(readFileSync('/tmp/vitest.json', 'utf8'))
      return data.numTotalTests ?? null
    } catch { return null }
  },
  /** Browser test count. `--list` needs no installed browser, so this is cheap. */
  'tests:browser': () => {
    const result = run('npx', ['playwright', 'test', '--list', '--reporter=json'])
    try {
      const data = JSON.parse(result.out.slice(result.out.indexOf('{')))
      const count = (data.suites ?? []).reduce(function walk(total, suite) {
        const specs = (suite.specs ?? []).length
        const nested = (suite.suites ?? []).reduce(walk, 0)
        return total + specs + nested
      }, 0)
      return count || null
    } catch { return null }
  },
  /** Failed requests in the published artifact, asserted by check-build. */
  'checks:scripts-passing': () => {
    const scripts = ['scripts/check-docs.mjs', 'scripts/check-sql.mjs', 'scripts/guard-secrets.mjs', 'scripts/agent-guards.mjs']
    let passing = 0
    for (const script of scripts) {
      if (existsSync(script) && run('node', [script]).ok) passing++
    }
    return passing
  },
  'limits:cloud-input': () => {
    const found = /string\(input\.text, (\d+), 80\)/.exec(readFileSync('server/tools/summary.ts', 'utf8'))
    return found ? Number(found[1]) : null
  },
  'limits:local-text': () => {
    const found = /MAX_TEXT_LENGTH = (\d+)/.exec(readFileSync('src/lib/summary.ts', 'utf8'))
    return found ? Number(found[1]) : null
  },
  'limits:saved-items': () => {
    const found = /MAX_SAVED_ITEMS = (\d+)/.exec(readFileSync('src/lib/storage.ts', 'utf8'))
    return found ? Number(found[1]) : null
  },
  'limits:rate-minute': () => {
    const found = /const PER_MINUTE = (\d+)/.exec(readFileSync('server/ai.ts', 'utf8'))
    return found ? Number(found[1]) : null
  },
  'limits:timeout-ms': () => {
    const found = /const MAX_TIMEOUT = (\d+)/.exec(readFileSync('server/ai.ts', 'utf8'))
    return found ? Number(found[1]) : null
  },
  'coverage:statements': () => {
    if (!FULL) return null
    const result = run('npx', ['vitest', 'run', '--coverage', '--coverage.reporter=text-summary'])
    const found = /Statements\s*:\s*([\d.]+)%/.exec(result.out)
    return found ? Math.floor(Number(found[1])) : null
  },
}

/* ---------- Parse claims ---------- */

if (!existsSync(DOC)) {
  console.error('evidence=failed reason=missing_evidence_doc')
  process.exit(1)
}

const text = readFileSync(DOC, 'utf8')
// Cells may or may not be wrapped in backticks; accept both so the document
// stays readable while the parser stays strict about the structure.
const CLAIM = /^\|\s*`([\w:.-]+)`\s*\|\s*`?([\w:.-]+)`?\s*\|\s*([^\s|]+)\s*\|/gm
let found = 0
for (const match of text.matchAll(CLAIM)) {
  found++
  const [, id, kind, claimedRaw] = match
  const claimed = Number(String(claimedRaw).replace(/[,_%]/g, ''))
  const measure = measurements[kind]
  if (!measure) {
    report(id, kind, claimed, '—', 'FAIL', 'no measurement exists for this kind')
    continue
  }
  const actual = measure()
  if (actual === null || Number.isNaN(actual)) {
    report(id, kind, claimed, '—', 'NOT RUN', FULL ? 'measurement unavailable' : 'skipped in fast mode')
    continue
  }
  report(id, kind, claimed, actual, actual === claimed ? 'PASS' : 'FAIL', actual === claimed ? 'matches' : `document says ${claimed}, measured ${actual}`)
}

if (!found) {
  console.error(`evidence=failed reason=no_claims_parsed_in_${DOC}`)
  process.exit(1)
}

/* ---------- Report ---------- */

const failed = rows.filter((row) => row.status === 'FAIL')
const unrun = rows.filter((row) => row.status === 'NOT RUN')
const pad = Math.max(...rows.map((row) => row.id.length))
for (const row of rows) {
  console.log(`${row.status.padEnd(7)} ${row.id.padEnd(pad)}  claimed=${row.claimed}  measured=${row.actual}${row.status === 'FAIL' ? `  ${row.detail}` : ''}`)
}
console.log(`evidence=${failed.length ? 'failed' : 'passed'} claims=${rows.length} pass=${rows.length - failed.length - unrun.length} not_run=${unrun.length}`)

if (failed.length) {
  for (const row of failed) console.error(`::error title=Unsupported claim::${row.id} - ${row.detail}`)
  process.exit(1)
}
