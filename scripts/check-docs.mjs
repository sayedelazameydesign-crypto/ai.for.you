#!/usr/bin/env node
/**
 * Documentation drift guard.
 *
 * A document that silently lies is worse than no document. This script asserts
 * three things a human reviewer keeps forgetting to check by hand:
 *
 *   1. Every relative link in a tracked Markdown file resolves to a real file.
 *   2. Every number the docs publish as a product limit still exists in the code
 *      that enforces it (`src/lib`, `server/tools`, `shared`).
 *   3. Every error code in the wire contract is documented in docs/API.md.
 *
 * It prints file names, rule ids and the offending value only. It never rewrites
 * anything: detection is automated, correction stays a reviewed change.
 *
 * Usage: node scripts/check-docs.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, normalize, resolve } from 'node:path'

const ROOT = process.cwd()
const fail = (rule, detail) => {
  console.error(`docs_guard=failed rule=${rule}`)
  console.error(`::error title=Documentation drift::${rule} - ${detail}`)
  process.exitCode = 1
}

const tracked = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const markdown = tracked.filter((file) => file.endsWith('.md'))
for (const required of ['README.md', 'SECURITY.md', 'docs/SELF-MAINTAINING.md', 'docs/API.md']) {
  if (!markdown.includes(required)) fail('missing_required_doc', `${required} is not tracked`)
}

const read = (file) => readFileSync(resolve(ROOT, file), 'utf8')

/* 1. Relative links and anchors ------------------------------------------- */

const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g
let linksChecked = 0
for (const file of markdown) {
  const text = read(file)
  for (const match of text.matchAll(LINK)) {
    const target = match[1]
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) continue // external, mailto, in-page anchor
    const [pathPart] = target.split('#')
    if (!pathPart) continue
    linksChecked++
    const resolved = normalize(resolve(ROOT, dirname(file), decodeURIComponent(pathPart)))
    if (!resolved.startsWith(ROOT)) { fail('link_escapes_repo', `${file} -> ${target}`); continue }
    if (!existsSync(resolved)) fail('broken_relative_link', `${file} -> ${target}`)
  }
}

/* 2. Published limits must exist in the enforcing code --------------------- */

/** Every number a document *claims* as a limit, paired with a code pattern. */
const CLAIMS = [
  { id: 'local-text-limit', value: '20,000', pattern: /MAX_TEXT_LENGTH = 20000/, file: 'src/lib/summary.ts' },
  { id: 'local-code-limit', value: '20,000', pattern: /MAX_CODE_LENGTH = 20000/, file: 'src/lib/code.ts' },
  { id: 'cloud-input-limit', value: '12,000', pattern: /string\(input\.\w+, 12000,/, file: 'server/tools' },
  { id: 'saved-items-limit', value: '50', pattern: /MAX_SAVED_ITEMS = 50/, file: 'src/lib/storage.ts' },
  { id: 'daily-limit-default', value: '40', pattern: /boundedInt\(env\.AI_DAILY_LIMIT, 40,/, file: 'server/ai.ts' },
]
let claimsChecked = 0
for (const claim of CLAIMS) {
  const docsMention = markdown.filter((file) => read(file).includes(claim.value))
  if (!docsMention.length) { fail('unpublished_limit', `${claim.id} = ${claim.value} appears in no document`); continue }
  claimsChecked++
  const candidates = claim.file.endsWith('/tools')
    ? tracked.filter((file) => file.startsWith('server/tools/') && file.endsWith('.ts'))
    : [claim.file]
  const enforced = candidates.some((file) => existsSync(resolve(ROOT, file)) && claim.pattern.test(read(file)))
  if (!enforced) fail('doc_claims_code_does_not', `${claim.id}: docs say ${claim.value}, no match in ${claim.file}`)
}

/* 3. The wire contract and its documentation agree ------------------------- */

const contract = read('shared/contract.ts')
const apiDoc = read('docs/API.md')
const codes = [...contract.matchAll(/'([a-z][a-z0-9-]+)'/g)]
  .map((match) => match[1])
  .filter((code) => /^(method|origin|content-type|not-configured|access|rate-limit|body|input|model|provider|output|timeout)/.test(code))
for (const code of new Set(codes)) {
  if (code === 'provider') continue // substring of the provider-* codes
  if (!apiDoc.includes(code)) fail('undocumented_error_code', `shared/contract.ts:${code} is absent from docs/API.md`)
}

/* 4. The maintenance document must not claim unverified work --------------- */

const maint = read('docs/SELF-MAINTAINING.md')
// The maintenance doc must publish measurable evidence, not only intentions.
// Either an explicit evidence section or the PASS/FAIL/NOT RUN report table.
if (!/##\s*.*(?:الإثبات|القياس)/.test(maint)) {
  fail('missing_evidence_section', 'docs/SELF-MAINTAINING.md needs an evidence or measurement section')
}
if (!/NOT RUN/.test(maint)) fail('missing_third_state', 'docs/SELF-MAINTAINING.md must document the NOT RUN state')
// A standalone placeholder line, not an inline mention of the rule itself.
if (/^[ \t]*(?:TODO|TBD|FIXME)\b/m.test(maint)) fail('placeholder_text', 'docs/SELF-MAINTAINING.md has an unfinished placeholder line')

if (process.exitCode) process.exit(process.exitCode)
console.log(`docs_guard=passed markdown=${markdown.length} links=${linksChecked} limits=${claimsChecked} error_codes=${new Set(codes).size}`)
