#!/usr/bin/env node
/**
 * Assert the production build is complete and within GitHub Pages limits,
 * without uploading an artifact that no job consumes.
 * Limits: published site <= 1 GB. See docs/FREE-TIERS.md.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
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

// A secret must never reach a published asset.
const ASSETS = join(DIST, 'assets')
if (existsSync(ASSETS)) {
  for (const name of readdirSync(ASSETS)) {
    if (!/\.(js|css)$/.test(name)) continue
    const text = readFileSync(join(ASSETS, name), 'utf8')
    if (/\bgsk_[A-Za-z0-9]{20,}/.test(text)) fail('provider_key_in_bundle')
  }
}

console.log(`build_check=passed files=${files} size_mb=${(bytes / 1048576).toFixed(2)} pages_limit_mb=1024`)
