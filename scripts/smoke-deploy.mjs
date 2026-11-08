#!/usr/bin/env node
/**
 * Post-deploy smoke test. Requests the published page and, when an API origin is
 * configured, the versioned status endpoint. Prints only statuses and reason
 * codes — never bodies, headers, credentials or model names.
 *
 * Usage: node scripts/smoke-deploy.mjs <site-url> [api-base]
 * Exit code 1 means the deployment must not be considered healthy.
 */
const siteUrl = process.argv[2]
const apiBase = process.argv[3] || ''
const ATTEMPTS = 5
const TIMEOUT_MS = 15000

if (!siteUrl || !/^https?:\/\//.test(siteUrl)) {
  console.error('reason=invalid_url - Pass the published site URL as the first argument.')
  process.exit(1)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function probe(url, validate) {
  let reason = 'network_or_timeout'
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(TIMEOUT_MS) })
      if (!response.ok) {
        reason = `http_${response.status}`
      } else {
        const body = await response.text()
        const failure = validate(body, response)
        if (!failure) return { ok: true, reason: 'ok', status: response.status, attempt }
        reason = failure
      }
    } catch {
      reason = 'network_or_timeout'
    }
    if (attempt < ATTEMPTS) await sleep(attempt * 3000)
  }
  return { ok: false, reason, status: 0, attempt: ATTEMPTS }
}

// After a repository rename or a domain move, a stale canonical is the failure
// that nobody notices: the page still loads, but search engines and social
// previews point at the old address. Compare it with the URL actually served.
const normalize = (value) => { try { return new URL(value).href.replace(/\/$/, '') } catch { return '' } }
let canonical = ''
let canonicalState = 'absent'

const page = await probe(siteUrl, (body) => {
  if (!/<div id="root"><\/div>/.test(body)) return 'missing_root'
  if (!/<html[^>]+dir="rtl"/.test(body)) return 'missing_rtl'
  if (/__(TITLE|DESCRIPTION|THEME_COLOR)__/.test(body)) return 'unreplaced_placeholder'
  if (!/<script[^>]+type="module"/.test(body)) return 'missing_bundle'
  const match = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(body)
  canonical = match ? match[1] : ''
  canonicalState = !canonical ? 'absent' : normalize(canonical) === normalize(siteUrl) ? 'match' : 'mismatch'
  if (process.env.SMOKE_STRICT_IDENTITY === '1' && canonicalState !== 'match') return `canonical_${canonicalState}`
  return ''
})
console.log(`page_status=${page.status} page=${page.ok ? 'passed' : 'failed'} reason=${page.reason} attempts=${page.attempt}`)
// Report the URL only; it is public identity, not a secret.
console.log(`canonical=${canonicalState}${canonicalState === 'mismatch' ? ` expected=${normalize(siteUrl)} found=${normalize(canonical)}` : ''}`)

let api = { ok: true, reason: 'skipped', status: 0, attempt: 0 }
if (apiBase) {
  const statusUrl = `${apiBase.replace(/\/+$/, '')}/api/v1/status`
  api = await probe(statusUrl, (body, response) => {
    if (!response.headers.get('content-type')?.includes('application/json')) return 'not_json'
    try {
      const data = JSON.parse(body)
      if (typeof data.configured !== 'boolean') return 'unexpected_shape'
    } catch { return 'invalid_json' }
    return ''
  })
  console.log(`api_status=${api.status} api=${api.ok ? 'passed' : 'failed'} reason=${api.reason} attempts=${api.attempt}`)
} else {
  console.log('api=skipped reason=no_api_base')
}

if (!page.ok || !api.ok) {
  console.error(`deployment_smoke=failed page_reason=${page.reason} api_reason=${api.reason}`)
  process.exit(1)
}
console.log('deployment_smoke=passed')
