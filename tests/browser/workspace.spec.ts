import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join, normalize, resolve } from 'node:path'
import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { buildThreeCodeSnippet } from '../../src/lib/space3d'

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
    for (const route of ['/', '/#/space', '/#/marketing', '/#/summary', '/#/code', '/#/saved', '/#/settings', '/#/guide']) {
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
  for (const route of ['/', '/#/space', '/#/marketing', '/#/summary', '/#/code', '/#/saved', '/#/settings', '/#/guide']) {
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

  const appOrigin = 'https://app.celia.example'
  const declaredOrigin = 'https://api.declared.example'
  const forbiddenOrigin = 'https://api.forbidden.example'
  const outDir = mkdtempSync(join(tmpdir(), 'celia-dist-csp-'))

  const vercelConfig = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    headers?: Array<{ source?: string; headers?: Array<{ key: string; value: string }> }>
  }
  const globalRule = (vercelConfig.headers ?? []).find((rule) => rule.source === '/(.*)')
  const edgeHeaders: Record<string, string> = {}
  for (const header of globalRule?.headers ?? []) {
    edgeHeaders[header.key.toLowerCase()] = header.value
  }

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

  try {
    execFileSync('npx', ['vite', 'build', '--outDir', outDir], {
      cwd: process.cwd(),
      env: { ...process.env, VITE_API_BASE: declaredOrigin },
      stdio: 'pipe',
    })

    const builtHtml = readFileSync(join(outDir, 'index.html'), 'utf8')
    expect(builtHtml).toContain(`connect-src &#39;self&#39; ${declaredOrigin}`)

    let declaredHits = 0
    let forbiddenHits = 0

    await page.route(/^https:\/\/app\.celia\.example(?:\/|$)/, async (route) => {
      const reqPath = new URL(route.request().url()).pathname
      const relPath = reqPath === '/' ? 'index.html' : reqPath.replace(/^\/+/, '')
      const candidate = normalize(resolve(outDir, relPath))
      if (!candidate.startsWith(outDir) || !existsSync(candidate) || statSync(candidate).isDirectory()) {
        await route.fulfill({ status: 404, headers: edgeHeaders, body: 'not found' })
        return
      }
      const contentType = mimeTypes[extname(candidate)] ?? 'application/octet-stream'
      await route.fulfill({
        status: 200,
        headers: { ...edgeHeaders, 'content-type': contentType },
        body: readFileSync(candidate),
      })
    })

    await page.route(/^https:\/\/api\.declared\.example\//, async (route) => {
      declaredHits++
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ configured: true, provider: 'Groq' }),
      })
    })
    await page.route(/^https:\/\/api\.forbidden\.example\//, async (route) => {
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

    await page.goto(`${appOrigin}/`)
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
    rmSync(outDir, { recursive: true, force: true })
  }
})

test('optional Three.js space stays lazy on home and renders both interactive 3D modes on #/space', async ({ page }) => {
  const requestedScripts: string[] = []
  page.on('request', (req) => {
    if (req.resourceType() === 'script') requestedScripts.push(req.url())
  })

  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1 })).toContainText('أدوات صغيرة')
  await page.waitForLoadState('networkidle')

  // Initial 2D workspace must never fetch the Three.js or Space modules.
  expect(requestedScripts.some((url) => /(?:\/three|[/.]Space)/i.test(url))).toBe(false)

  await page.getByRole('button', { name: /افتح الفضاء ثلاثي الأبعاد/ }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مساحتك في أبعاد ثلاثة.')
  expect(await page.evaluate(() => location.hash)).toBe('#/space')

  // Once #/space is opened, the 3D module is fetched on demand and has no horizontal overflow.
  expect(requestedScripts.some((url) => /Space/i.test(url))).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

  // Exercise 360° Showcase mode, configurator controls and live code generator.
  await page.getByRole('button', { name: /مستعرض ومخصّص 360°/ }).click()
  await page.getByRole('button', { name: /نواة Celia الذكية/ }).click()
  await page.getByRole('button', { name: 'اللون: زمردي هادئ' }).click()
  await page.getByRole('button', { name: 'زجاجي لامع' }).click()
  await expect(page.getByLabel('كود Three.js المولّد')).toContainText('MeshPhysicalMaterial')

  // Verify mobile layout has zero horizontal overflow on #/space.
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('Three.js runtime suspends RAF when paused, reuses a single WebGL context without geometry leaks, and exports runnable multi-layer ES modules', async ({ page, context }) => {
  test.setTimeout(60000)
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])

  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/#/space')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('مساحتك في أبعاد ثلاثة.')

  const stage = page.locator('.space-stage')
  const readStats = () =>
    stage.evaluate((el) => {
      const fn = (el as unknown as {
        __celiaSpaceStats?: () => {
          frames: number
          loopActive: boolean
          continuous: boolean
          rendererMounts: number
          sceneSwaps: number
          gpuGeometries: number
          gpuTextures: number
        }
      }).__celiaSpaceStats
      return fn ? fn() : null
    })

  // 1. Active loop advances frames on a single live WebGLRenderer context
  //    (React StrictMode in dev mounts->cleans->remounts once on initial mount, then stays constant).
  await expect(stage).toHaveAttribute('data-render-state', 'active')
  await expect.poll(async () => (await readStats())?.frames ?? 0).toBeGreaterThanOrEqual(2)
  const initialStats = await readStats()
  expect(initialStats).not.toBeNull()
  expect(initialStats!.rendererMounts).toBeGreaterThanOrEqual(1)
  expect(initialStats!.rendererMounts).toBeLessThanOrEqual(2)
  expect(initialStats!.gpuGeometries).toBeGreaterThan(0)

  // 2. Switch to 360° Showcase (Sneaker = 13 model layers + 3 stage meshes + 1 starfield = 17 geometries)
  //    and capture an autoRotate=true snippet first, then verify manual pause stops RAF completely.
  await page.getByRole('button', { name: /مستعرض ومخصّص 360°/ }).click()
  const sneakerBaselineGeos = (await readStats())!.gpuGeometries
  expect(sneakerBaselineGeos).toBe(17)

  await page.getByRole('button', { name: 'زجاجي لامع' }).click()
  await page.getByRole('button', { name: 'اللون: بنفسجي Celia' }).click()
  await page.getByRole('button', { name: 'نسخ كود Three.js' }).click()
  const autoRotateSnippet = await page.evaluate(() => navigator.clipboard.readText())
  expect(autoRotateSnippet).toContain("modelGroup.name = 'model-sneaker'")
  expect(autoRotateSnippet).toContain('prefers-reduced-motion: reduce')
  expect(autoRotateSnippet).toContain('requestAnimationFrame(renderFrame)')

  await page.getByRole('button', { name: 'إيقاف الدوران التلقائي' }).click()
  await expect(stage).toHaveAttribute('data-render-state', 'idle')
  const pausedStats = (await readStats())!
  expect(pausedStats.loopActive).toBe(false)
  expect(pausedStats.continuous).toBe(false)

  await page.waitForTimeout(260)
  const afterIdleWait = (await readStats())!
  expect(afterIdleWait.frames).toBe(pausedStats.frames)
  expect(afterIdleWait.loopActive).toBe(false)

  // 3. Manual camera zoom while paused renders a single on-demand frame and returns to idle.
  await page.getByRole('button', { name: 'تكبير المشهد' }).click()
  await expect.poll(async () => (await readStats())?.frames ?? 0).toBe(pausedStats.frames + 1)
  await expect(stage).toHaveAttribute('data-render-state', 'idle')
  await page.waitForTimeout(180)
  expect((await readStats())!.frames).toBe(pausedStats.frames + 1)

  // 4. Resume autoRotate, then enable prefers-reduced-motion: reduce in Chromium:
  //    live loop must stop immediately, button must disable with explicit label, and UI snippet must switch to renderOnce().
  await page.getByRole('button', { name: 'تشغيل الدوران التلقائي' }).click()
  await expect(stage).toHaveAttribute('data-render-state', 'active')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(stage).toHaveAttribute('data-render-state', 'idle')
  const reducedBtn = page.getByRole('button', { name: 'الدوران التلقائي متوقف لاحترام تقليل الحركة' })
  await expect(reducedBtn).toBeDisabled()
  await expect(reducedBtn).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByLabel('كود Three.js المولّد')).toContainText('renderOnce()')

  // 5. Rapidly cycle models, swatches, materials and modes: must reuse the same WebGLRenderer
  //    and return to the exact baseline GPU geometry count (17) with zero leaks.
  await page.getByRole('button', { name: /نواة Celia الذكية/ }).click()
  await page.getByRole('button', { name: 'زجاجي لامع' }).click()
  await page.getByRole('button', { name: /بلّورة متعدّدة الأوجه/ }).click()
  await page.getByRole('button', { name: 'شبكي هندسي' }).click()
  await page.getByRole('button', { name: /شبكة CeliaOS الحية/ }).click()
  await page.getByRole('button', { name: /مستعرض ومخصّص 360°/ }).click()
  await page.getByRole('button', { name: /حذاء رياضي هندسي/ }).click()
  await page.getByRole('button', { name: 'زجاجي لامع' }).click()
  await page.getByRole('button', { name: 'اللون: بنفسجي Celia' }).click()

  const afterSwaps = (await readStats())!
  expect(afterSwaps.rendererMounts).toBe(initialStats!.rendererMounts)
  expect(afterSwaps.sceneSwaps).toBeGreaterThanOrEqual(8)
  expect(afterSwaps.gpuGeometries).toBe(17)
  expect(afterSwaps.loopActive).toBe(false)

  await page.getByRole('button', { name: 'نظرة عامة', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('أدوات صغيرة')
  const unmountSnapshot = await page.evaluate(
    () => (window as unknown as { __celiaSpaceLastUnmount?: { gpuGeometries: number; gpuTextures: number } }).__celiaSpaceLastUnmount ?? null,
  )
  expect(unmountSnapshot).toEqual({ gpuGeometries: 0, gpuTextures: 0 })

  // 6. Execute the autoRotate=true exported ES module in Chromium while prefers-reduced-motion: reduce
  //    is active — proving the exported snippet itself suppresses RAF (frame stays 1 after 200ms).
  const threeModuleJs = readFileSync('node_modules/three/build/three.module.js', 'utf8')
  const threeCoreJs = readFileSync('node_modules/three/build/three.core.js', 'utf8')
  await page.route(/^https:\/\/three-export-sandbox\.example\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/' || pathname === '/index.html') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: [
          '<!doctype html><html><head>',
          '<script type="importmap">{"imports":{"three":"./three.module.js"}}</script>',
          '</head><body>',
          '<script type="module">import * as exported from "./exported-scene.js"; window.__exportedScene = exported;</script>',
          '</body></html>',
        ].join(''),
      })
      return
    }
    if (pathname === '/three.module.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: threeModuleJs })
      return
    }
    if (pathname === '/three.core.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: threeCoreJs })
      return
    }
    if (pathname === '/exported-scene.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: autoRotateSnippet })
      return
    }
    await route.fulfill({ status: 404, body: 'not found' })
  })

  await page.goto('https://three-export-sandbox.example/')
  await page.waitForFunction(() => Boolean((window as unknown as { __exportedScene?: unknown }).__exportedScene))

  const exportVerify = await page.evaluate(async () => {
    const mod = (window as unknown as {
      __exportedScene: {
        modelGroup: { name: string; children: Array<{ geometry: { type: string }; material: { type: string; clearcoat?: number } }> }
        root: { children: Array<{ type: string; geometry?: { type: string } }> }
        renderer: { info: { render: { frame: number; triangles: number }; memory: { geometries: number } }; dispose: () => void }
      }
    }).__exportedScene
    const frameAtMount = mod.renderer.info.render.frame
    const trianglesAtMount = mod.renderer.info.render.triangles
    const geometriesAtMount = mod.renderer.info.memory.geometries
    await new Promise((resolve) => setTimeout(resolve, 200))
    const frameAfterIdle = mod.renderer.info.render.frame
    const result = {
      modelName: mod.modelGroup.name,
      layerCount: mod.modelGroup.children.length,
      geometryTypes: mod.modelGroup.children.map((c) => c.geometry.type),
      materialTypes: Array.from(new Set(mod.modelGroup.children.map((c) => c.material.type))),
      clearcoat: mod.modelGroup.children[0]?.material?.clearcoat ?? 0,
      stageMeshCount: mod.root.children.filter((c) => c.type === 'Mesh').length,
      frameAtMount,
      frameAfterIdle,
      trianglesAtMount,
      geometriesAtMount,
    }
    mod.renderer.dispose()
    return result
  })

  expect(exportVerify.modelName).toBe('model-sneaker')
  expect(exportVerify.layerCount).toBe(13)
  expect(exportVerify.geometryTypes).toContain('ExtrudeGeometry')
  expect(exportVerify.geometryTypes).toContain('CapsuleGeometry')
  expect(exportVerify.geometryTypes).toContain('TorusGeometry')
  expect(exportVerify.materialTypes).toEqual(['MeshPhysicalMaterial'])
  expect(exportVerify.clearcoat).toBe(1)
  expect(exportVerify.stageMeshCount).toBe(3)
  expect(exportVerify.trianglesAtMount).toBeGreaterThan(1000)
  expect(exportVerify.geometriesAtMount).toBe(16)
  expect(exportVerify.frameAtMount).toBe(1)
  expect(exportVerify.frameAfterIdle).toBe(1)
  expect(errors).toEqual([])
})

test('exported Three.js module loaded in a hidden tab with reduced motion paints one static frame on visibility restore without starting RAF or leaking GPU memory', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1280, height: 800 })

  const autoRotateSnippet = buildThreeCodeSnippet({
    model: 'sneaker',
    swatch: 'violet',
    material: 'glass',
    autoRotate: true,
  })
  const threeModuleJs = readFileSync('node_modules/three/build/three.module.js', 'utf8')
  const threeCoreJs = readFileSync('node_modules/three/build/three.core.js', 'utf8')

  await page.route(/^https:\/\/three-export-sandbox\.example\//, async (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname === '/hidden-tab.html') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: [
          '<!doctype html><html><head>',
          '<script>',
          'window.__hiddenState = true;',
          'window.__rafCount = 0;',
          'const __origRaf = window.requestAnimationFrame.bind(window);',
          'window.requestAnimationFrame = (cb) => { window.__rafCount += 1; return __origRaf(cb); };',
          'Object.defineProperty(document, "hidden", { configurable: true, get: () => window.__hiddenState });',
          'Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (window.__hiddenState ? "hidden" : "visible") });',
          '</script>',
          '<script type="importmap">{"imports":{"three":"./three.module.js"}}</script>',
          '</head><body>',
          '<script type="module">import * as exported from "./exported-scene.js"; window.__exportedScene = exported;</script>',
          '</body></html>',
        ].join(''),
      })
      return
    }
    if (pathname === '/three.module.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: threeModuleJs })
      return
    }
    if (pathname === '/three.core.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: threeCoreJs })
      return
    }
    if (pathname === '/exported-scene.js') {
      await route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: autoRotateSnippet })
      return
    }
    await route.fulfill({ status: 404, body: 'not found' })
  })

  await page.goto('https://three-export-sandbox.example/hidden-tab.html')
  await page.waitForFunction(() => Boolean((window as unknown as { __exportedScene?: unknown }).__exportedScene))

  const lifecycleVerify = await page.evaluate(async () => {
    const win = window as unknown as {
      __hiddenState: boolean
      __rafCount: number
      __exportedScene: {
        subjectGroup: { rotation: { y: number } }
        modelGroup: { name: string; children: Array<unknown> }
        root: {
          traverse: (cb: (obj: { geometry?: { dispose: () => void }; material?: { dispose: () => void } | Array<{ dispose: () => void }> }) => void) => void
        }
        scene: { clear: () => void }
        renderer: {
          info: { render: { frame: number; triangles: number }; memory: { geometries: number; textures: number } }
          dispose: () => void
        }
      }
    }
    const mod = win.__exportedScene

    // 1. Loaded while hidden: 0 frames rendered and 0 RAF calls scheduled, even after waiting.
    await new Promise((resolve) => setTimeout(resolve, 180))
    const frameWhileHidden = mod.renderer.info.render.frame
    const rafWhileHidden = win.__rafCount

    // 2. Tab returns to foreground: paints 1 static frame immediately, without scheduling RAF.
    win.__hiddenState = false
    document.dispatchEvent(new Event('visibilitychange'))
    const frameOnRestore = mod.renderer.info.render.frame
    const trianglesOnRestore = mod.renderer.info.render.triangles
    const geometriesOnRestore = mod.renderer.info.memory.geometries
    const rafOnRestore = win.__rafCount

    // 3. Remains idle in foreground: no continuous animation loop starts and rotation stays 0.
    await new Promise((resolve) => setTimeout(resolve, 220))
    const frameAfterVisibleWait = mod.renderer.info.render.frame
    const rafAfterVisibleWait = win.__rafCount
    const rotationY = mod.subjectGroup.rotation.y
    const geometriesAfterWait = mod.renderer.info.memory.geometries

    // 4. Disposing scene meshes + renderer releases all GPU geometries and textures cleanly.
    mod.root.traverse((obj) => {
      obj.geometry?.dispose()
      if (Array.isArray(obj.material)) {
        for (const mat of obj.material) mat.dispose()
      } else {
        obj.material?.dispose()
      }
    })
    mod.scene.clear()
    mod.renderer.dispose()
    const geometriesAfterDispose = mod.renderer.info.memory.geometries
    const texturesAfterDispose = mod.renderer.info.memory.textures

    return {
      modelName: mod.modelGroup.name,
      layerCount: mod.modelGroup.children.length,
      frameWhileHidden,
      rafWhileHidden,
      frameOnRestore,
      trianglesOnRestore,
      geometriesOnRestore,
      rafOnRestore,
      frameAfterVisibleWait,
      rafAfterVisibleWait,
      rotationY,
      geometriesAfterWait,
      geometriesAfterDispose,
      texturesAfterDispose,
    }
  })

  expect(lifecycleVerify.modelName).toBe('model-sneaker')
  expect(lifecycleVerify.layerCount).toBe(13)
  expect(lifecycleVerify.frameWhileHidden).toBe(0)
  expect(lifecycleVerify.rafWhileHidden).toBe(0)
  expect(lifecycleVerify.frameOnRestore).toBe(1)
  expect(lifecycleVerify.trianglesOnRestore).toBeGreaterThan(1000)
  expect(lifecycleVerify.geometriesOnRestore).toBe(16)
  expect(lifecycleVerify.rafOnRestore).toBe(0)
  expect(lifecycleVerify.frameAfterVisibleWait).toBe(1)
  expect(lifecycleVerify.rafAfterVisibleWait).toBe(0)
  expect(lifecycleVerify.rotationY).toBe(0)
  expect(lifecycleVerify.geometriesAfterWait).toBe(16)
  expect(lifecycleVerify.geometriesAfterDispose).toBe(0)
  expect(lifecycleVerify.texturesAfterDispose).toBe(0)
  expect(errors).toEqual([])
})
