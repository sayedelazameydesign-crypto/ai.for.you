import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

test('dashboard, local generation, persistence, copy and download work in a real browser', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('أدوات صغيرة')
  await page.getByRole('button', { name: 'جرّب مولّد المحتوى' }).click()
  await page.getByRole('button', { name: 'جرّب مثالاً' }).click()
  await page.getByRole('button', { name: 'اكتب لي 3 أفكار' }).click()
  await expect(page.locator('.copy-variant')).toHaveCount(3)
  await page.getByRole('button', { name: 'نسخ النتيجة' }).first().click()
  await expect(page.getByRole('button', { name: 'تم النسخ' })).toBeVisible()
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('نبتة')
  await page.getByRole('button', { name: 'حفظ في المكتبة' }).first().click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: 'تنزيل كملف نصي' }).click()
  expect((await downloadEvent).suggestedFilename()).toBe('lek-marketing.txt')
  await page.reload()
  await page.getByRole('button', { name: /النتائج المحفوظة/ }).click()
  await expect(page.locator('.saved-card')).toHaveCount(1)
  await page.getByRole('button', { name: /حذف نبتة/ }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'حذف النتيجة' }).click()
  await expect(page.getByText('مساحة لأفكارك القادمة')).toBeVisible()
  expect(errors).toEqual([])
})

test('summary file validation and code analysis work', async ({ page }) => {
  await page.goto('/#/summary')
  await page.getByLabel('رفع ملف نصي').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: Buffer.from('not an image') })
  await expect(page.getByRole('alert')).toContainText('TXT وMarkdown')
  await page.getByLabel('رفع ملف نصي').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('Clear priorities help a team focus. Weekly reviews reveal blocked work. Rest supports better decisions. Small sustainable changes improve a process. A useful review asks what should change next week.') })
  await page.getByRole('button', { name: 'أعطني الخلاصة' }).click()
  await expect(page.getByRole('heading', { name: 'خلاصة النص' })).toBeVisible()
  await page.goto('/#/code')
  await page.getByRole('button', { name: 'جرّب مثالاً' }).click()
  await page.getByRole('button', { name: 'افحص الكود', exact: true }).click()
  await expect(page.getByText('prefer-block-scope')).toBeVisible()
  await page.getByRole('button', { name: 'JSON', exact: true }).click()
  await page.getByRole('button', { name: 'جرّب مثالاً' }).click()
  await page.getByRole('button', { name: 'افحص الكود', exact: true }).click()
  await page.getByRole('button', { name: 'تطبيق التنسيق الآمن' }).click()
  await expect(page.getByLabel('محرر الكود')).toHaveValue(/\n {2}"project"/)
})

test('mobile drawer, theme persistence and deep links work without horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.getByRole('button', { name: 'فتح القائمة' }).click()
  const drawer = page.getByRole('dialog', { name: 'القائمة الرئيسية' })
  await expect(drawer).toBeVisible()
  await expect(page.locator('.main-shell')).toHaveAttribute('inert', '')
  for (let index = 0; index < 12; index++) {
    await page.keyboard.press('Tab')
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('.sidebar')))).toBe(true)
  }
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'فتح القائمة' })).toBeFocused()
  await page.getByRole('button', { name: 'فتح القائمة' }).click()
  await page.getByRole('button', { name: 'ملخّص النصوص', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('قراءة أقل')
  await expect(page.getByRole('main')).toBeFocused()
  await page.getByRole('button', { name: 'تفعيل الوضع الداكن' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.goto('/#/code')
  await page.reload()
  await expect(page.getByLabel('محرر الكود')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

for (const theme of ['light', 'dark']) {
  test(`core pages have no automated WCAG A/AA violations: ${theme}`, async ({ page }) => {
    test.setTimeout(60000)
    await page.goto('/')
    if (theme === 'dark') await page.getByRole('button', { name: 'تفعيل الوضع الداكن' }).click()
    for (const route of ['/', '/#/marketing', '/#/summary', '/#/code', '/#/saved', '/#/settings', '/#/guide']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      expect(report.violations, `${theme} ${route}`).toEqual([])
    }
  })
}

// A5: the policy must not break the app. This is the test that decides whether
// the CSP is safe to ship.
//
// It deliberately asserts on *policy violations* rather than on fonts or on a
// zero count of console messages. An earlier version asserted that a specific
// webfont reported as loaded and that no console message mentioned "Content
// Security Policy" — both are environment-sensitive and produced a red build
// that proved nothing. What matters is: did the browser block anything the app
// needs, and does the app still work end to end?
test('content security policy blocks nothing the app needs', async ({ page }) => {
  test.setTimeout(90000)

  // Installed before any page script runs, so nothing is missed.
  await page.addInitScript(() => {
    const seen: string[] = []
    ;(window as unknown as { __cspViolations: string[] }).__cspViolations = seen
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} ${event.blockedURI}`)
    })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('أدوات صغيرة')

  // Walk every route so lazily loaded chunks are exercised under the policy.
  for (const route of ['/', '/#/marketing', '/#/summary', '/#/code', '/#/saved', '/#/settings', '/#/guide']) {
    await page.goto(route)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  }

  // The app must still be interactive: the local engine produces three drafts.
  await page.goto('/#/marketing')
  await page.getByRole('button', { name: 'جرّب مثالاً' }).click()
  await page.getByRole('button', { name: 'اكتب لي 3 أفكار' }).click()
  await expect(page.locator('.copy-variant')).toHaveCount(3)

  // Let any late violation (e.g. a deferred font fetch) surface before reading.
  await page.waitForLoadState('networkidle')

  const violations = await page.evaluate(() => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [])
  // Print the exact directive before asserting: a CI failure should name its cause.
  if (violations.length) console.log('CSP_EVIDENCE', JSON.stringify(violations))
  expect(violations, `blocked: ${violations.join(' | ')}`).toEqual([])
})

test('production build with VITE_API_BASE allows the declared origin and blocks undeclared origins under Vercel + meta CSP', async ({ page }) => {
  test.setTimeout(90000)

  const declaredOrigin = 'https://api.declared.example'
  const forbiddenOrigin = 'https://api.forbidden.example'
  const outDir = mkdtempSync(join(tmpdir(), 'celia-dist-csp-'))

  const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    headers?: Array<{ source?: string; headers?: Array<{ key: string; value: string }> }>
  }
  const edgeHeaders = (vercelConfig.headers ?? []).flatMap((rule) => rule.headers ?? [])

  const mimeTypes: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  const server = createServer((req, res) => {
    for (const header of edgeHeaders) res.setHeader(header.key, header.value)
    const reqPath = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    const relPath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '')
    const candidate = normalize(resolve(outDir, relPath))
    if (!candidate.startsWith(outDir) || !existsSync(candidate) || statSync(candidate).isDirectory()) {
      res.writeHead(404).end('not found')
      return
    }
    const contentType = mimeTypes[extname(candidate)] ?? 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': contentType })
    res.end(readFileSync(candidate))
  })

  try {
    execFileSync('npx', ['vite', 'build', '--outDir', outDir], {
      cwd: process.cwd(),
      env: { ...process.env, VITE_API_BASE: declaredOrigin },
      stdio: 'pipe',
    })

    const builtHtml = readFileSync(join(outDir, 'index.html'), 'utf8')
    expect(builtHtml).toContain(`connect-src &#39;self&#39; ${declaredOrigin}`)

    await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    const { port } = server.address() as AddressInfo

    let declaredHits = 0
    let forbiddenHits = 0

    await page.route(`${declaredOrigin}/**`, async (route) => {
      declaredHits++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ configured: true, provider: 'Groq' }),
      })
    })
    await page.route(`${forbiddenOrigin}/**`, async (route) => {
      forbiddenHits++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ ok: true }),
      })
    })

    await page.addInitScript(() => {
      const seen: Array<{ directive: string; blockedURI: string }> = []
      ;(window as unknown as { __cspEvents: typeof seen }).__cspEvents = seen
      document.addEventListener('securitypolicyviolation', (event) => {
        seen.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI })
      })
    })

    await page.goto(`http://127.0.0.1:${port}/`)
    await expect(page.getByRole('heading', { level: 1 })).toContainText('أدوات صغيرة')

    // Startup status check in WorkspaceContext must reach the declared VITE_API_BASE.
    await expect.poll(() => declaredHits).toBeGreaterThanOrEqual(1)

    const allowedProbe = await page.evaluate(async (origin) => {
      const response = await fetch(`${origin}/api/v1/status`)
      return { status: response.status, data: await response.json() as { configured?: boolean } }
    }, declaredOrigin)
    expect(allowedProbe).toEqual({ status: 200, data: { configured: true, provider: 'Groq' } })

    const initialViolations = await page.evaluate(
      () => (window as unknown as { __cspEvents?: Array<{ directive: string; blockedURI: string }> }).__cspEvents ?? [],
    )
    expect(initialViolations).toEqual([])

    // An undeclared external origin must be blocked by connect-src before reaching the network.
    const blockedProbe = await page.evaluate(async (origin) => {
      try {
        await fetch(`${origin}/api/v1/status`)
        return 'unexpectedly-allowed'
      } catch {
        return 'blocked'
      }
    }, forbiddenOrigin)
    expect(blockedProbe).toBe('blocked')
    expect(forbiddenHits).toBe(0)

    await expect.poll(async () => {
      const events = await page.evaluate(
        () => (window as unknown as { __cspEvents?: Array<{ directive: string; blockedURI: string }> }).__cspEvents ?? [],
      )
      return events.some((e) => e.directive === 'connect-src' && e.blockedURI.startsWith(forbiddenOrigin))
    }).toBe(true)
  } finally {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    rmSync(outDir, { recursive: true, force: true })
  }
})
