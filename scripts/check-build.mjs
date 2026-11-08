#!/usr/bin/env node
/**
 * Assert the production build is complete and within GitHub Pages limits,
 * without uploading an artifact that no job consumes.
 * Limits: published site <= 1 GB. See docs/FREE-TIERS.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'

const DIST = 'dist'
const PAGES_LIMIT = 1024 * 1024 * 1024
const fail = (reason) => { console.error(`::error::build_check=failed reason=${reason}`); process.exit(1) }

if (!existsSync(DIST)) fail('missing_dist')

let bytes = 0
let files = 0
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) walk(path)
    else { bytes += statSync(path).size; files++ }
  }
}
walk(DIST)

if (files === 0) fail('empty_dist')
if (bytes > PAGES_LIMIT) fail('exceeds_pages_size_limit')

const html = readFileSync(join(DIST, 'index.html'), 'utf8')
if (!html.includes('<div id="root"></div>')) fail('missing_root')
if (/__(TITLE|DESCRIPTION|THEME_COLOR)__/.test(html)) fail('unreplaced_placeholder')
if (!/<script[^>]+type="module"/.test(html)) fail('missing_bundle')

// A5: the published artifact must carry the policy. GitHub Pages cannot send
// headers, so the meta tag is the only enforcement there and it must exist.
const cspMeta = /<meta http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html)
if (!cspMeta) fail('missing_csp_meta')
// The attribute is HTML-escaped in the artifact; compare against the real policy.
const csp = cspMeta[1]
  .replaceAll('&#39;', "'")
  .replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&')
  .replaceAll('&lt;', '<')
  .replaceAll('&gt;', '>')
if (csp.includes("'unsafe-eval'")) fail('csp_allows_eval')
if (/frame-ancestors/.test(csp)) fail('csp_meta_contains_ignored_directive')
if (!/script-src 'self'/.test(csp)) fail('csp_missing_script_src')
if (!/connect-src 'self'/.test(csp)) fail('csp_missing_connect_src')
if (/connect-src [^;]*\*/.test(csp)) fail('csp_connect_wildcard')

// A secret must never reach a published asset.
const ASSETS = join(DIST, 'assets')
if (existsSync(ASSETS)) {
  for (const name of readdirSync(ASSETS)) {
    if (!/\.(js|css)$/.test(name)) continue
    const text = readFileSync(join(ASSETS, name), 'utf8')
    if (/\bgsk_[A-Za-z0-9]{20,}/.test(text)) fail('provider_key_in_bundle')
  }
}

// Ship-less-JS budget, measured on the compressed bytes a visitor actually
// downloads. The Pages limit above is 1 GB and would never catch a bloated bundle.
// Budgets are deliberately a little above current output so normal growth passes
// but a heavy new dependency fails the build and has to be justified.
const BUDGETS = { js: 200 * 1024, css: 40 * 1024 }
const compressed = { js: 0, css: 0 }
if (existsSync(ASSETS)) {
  for (const name of readdirSync(ASSETS)) {
    const kind = name.endsWith('.js') ? 'js' : name.endsWith('.css') ? 'css' : null
    if (!kind) continue
    compressed[kind] += gzipSync(readFileSync(join(ASSETS, name))).length
  }
}
for (const [kind, limit] of Object.entries(BUDGETS)) {
  if (compressed[kind] > limit) {
    fail(`budget_exceeded_${kind} gzip_kb=${(compressed[kind] / 1024).toFixed(1)} limit_kb=${(limit / 1024).toFixed(0)}`)
  }
}

console.log(`build_check=passed files=${files} size_mb=${(bytes / 1048576).toFixed(2)} pages_limit_mb=1024`)
console.log(`bundle_gzip js_kb=${(compressed.js / 1024).toFixed(1)}/${BUDGETS.js / 1024} css_kb=${(compressed.css / 1024).toFixed(1)}/${BUDGETS.css / 1024}`)
