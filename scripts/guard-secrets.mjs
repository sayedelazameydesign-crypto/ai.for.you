#!/usr/bin/env node
/**
 * Cheap repository guard: no provider credential in tracked files, and no secret
 * assigned to a browser-exported prefix. Complements GitHub secret scanning,
 * which must also be enabled in repository settings.
 * Prints file names and rule ids only, never the matched value.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
const SKIP = new Set(['package-lock.json'])
const RULES = [
  { id: 'provider-key-literal', pattern: /\bgsk_[A-Za-z0-9]{20,}/ },
  { id: 'browser-exported-secret', pattern: /^\s*(?:VITE_|NEXT_PUBLIC_)[A-Z0-9_]*(?:API_KEY|SECRET|TOKEN|ACCESS_CODE)\s*=\s*\S+/m },
  { id: 'private-key-block', pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
]

const findings = []
for (const file of files) {
  if (SKIP.has(file) || /\.(png|jpe?g|gif|svg|woff2?|ico|pdf)$/i.test(file)) continue
  let text
  try { text = readFileSync(file, 'utf8') } catch { continue }
  for (const rule of RULES) if (rule.pattern.test(text)) findings.push(`${file}: ${rule.id}`)
}

if (findings.length) {
  console.error('secret_guard=failed')
  for (const finding of findings) console.error(`::error::${finding}`)
  process.exit(1)
}
console.log(`secret_guard=passed files=${files.length}`)
