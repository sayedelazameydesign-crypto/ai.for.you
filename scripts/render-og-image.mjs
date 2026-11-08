/*
 * Renders public/og-image.png from a self-contained HTML card.
 *
 * Social scrapers largely ignore SVG og:image, so the share card must be raster.
 * The Arabic font is embedded from node_modules rather than fetched, so the text
 * renders correctly instead of falling back to tofu boxes.
 *
 *   node scripts/render-og-image.mjs
 *
 * Requires a Chromium binary. Set PLAYWRIGHT_CHROMIUM_EXECUTABLE when the
 * Playwright download is unavailable.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { chromium } from '@playwright/test'
import { SITE_DEFAULTS } from '../shared/site.ts'

const root = new URL('..', import.meta.url)
const fontPath = (name) => new URL(`node_modules/${name}`, root)

const arabic = await readFile(fontPath('@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2'))
const arabicRegular = await readFile(fontPath('@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2'))
const latin = await readFile(fontPath('@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2'))

const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><style>
@font-face{font-family:Plex;src:url(data:font/woff2;base64,${arabic.toString('base64')}) format('woff2');font-weight:600}
@font-face{font-family:Plex;src:url(data:font/woff2;base64,${arabicRegular.toString('base64')}) format('woff2');font-weight:400}
@font-face{font-family:Manrope;src:url(data:font/woff2;base64,${latin.toString('base64')}) format('woff2');font-weight:200 800}
*{margin:0;box-sizing:border-box}
html,body{width:1200px;height:630px;overflow:hidden}
/* A clipping frame keeps the decorative washes from creating RTL scroll overflow,
   which would otherwise shift the whole card and crop the screenshot. */
.frame{position:relative;width:1200px;height:630px;overflow:hidden;
  background:linear-gradient(135deg,#f6f2fc,#ebe4f7);font-family:Plex,sans-serif}
.wash{position:absolute;border-radius:50%;filter:blur(2px)}
.w1{width:520px;height:520px;background:#c9b6f5;opacity:.30;top:-200px;right:-130px}
.w2{width:400px;height:400px;background:#a8d8c5;opacity:.24;bottom:-170px;left:-120px}
.card{position:relative;padding:74px 84px;height:100%;display:flex;flex-direction:column;align-items:flex-end;text-align:right}
.lock{display:flex;align-items:center;gap:22px;direction:ltr}
.mark{width:104px;height:104px;border-radius:30px;display:grid;place-items:center;
  background:linear-gradient(145deg,#8a70e0,#6b4fc4 62%,#593fae);box-shadow:0 14px 34px #6b4fc43d}
.mark svg{width:68px;height:68px;color:#fff}
.name{font-family:Manrope,sans-serif;font-weight:800;font-size:78px;letter-spacing:-3.4px;color:#2c2545;line-height:1}
.name span{color:#5f43a6}
h1{font-size:50px;font-weight:600;color:#3b3352;margin-top:40px;line-height:1.5}
p{font-size:26px;font-weight:400;color:#6a6280;margin-top:16px;line-height:1.7}
.pills{display:flex;gap:12px;margin-top:auto;flex-direction:row-reverse}
.pill{font-size:21px;font-weight:600;color:#5b43a2;background:#ffffffb8;border:1px solid #ded2f2;
  border-radius:999px;padding:11px 24px}
</style></head><body>
<div class="frame"><div class="wash w1"></div><div class="wash w2"></div>
<div class="card">
  <div class="lock">
    <span class="mark"><svg viewBox="0 0 32 32" fill="none"><path d="M21.4 21.6a8.2 8.2 0 1 1 .2-11.4" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24.6 6.5l1.25 3.4 3.4 1.25-3.4 1.25-1.25 3.4-1.25-3.4-3.4-1.25 3.4-1.25z" fill="currentColor"/></svg></span>
    <span class="name">celia<span>.sh</span></span>
  </div>
  <h1>أدوات ذكية، لاحتمالات أكبر</h1>
  <p>مولّد محتوى تسويقي · ملخّص نصوص · فاحص أكواد</p>
  <div class="pills"><span class="pill">مجاني</span><span class="pill">مفتوح المصدر</span><span class="pill">دون بطاقة ائتمان</span></div>
</div></div></body></html>`

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
if (executablePath && !existsSync(executablePath)) {
  console.error(`og_image=failed reason=missing_chromium path=${executablePath}`)
  process.exit(1)
}

const browser = await chromium.launch({ executablePath: executablePath || undefined, args: ['--no-sandbox', '--font-render-hinting=none'] })
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  // Measure rather than eyeball: any element crossing the frame means the card
  // would ship cropped, so fail loudly instead of writing a broken image.
  const overflow = await page.evaluate(() => {
    const bad = []
    for (const node of document.querySelectorAll('.card, .card *')) {
      const box = node.getBoundingClientRect()
      if (box.width === 0 && box.height === 0) continue
      if (box.left < -0.5 || box.top < -0.5 || box.right > 1200.5 || box.bottom > 630.5) {
        bad.push(`${node.className || node.tagName}: ${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.right)},${Math.round(box.bottom)}`)
      }
    }
    return bad
  })
  if (overflow.length) {
    console.error(`og_image=failed reason=content_outside_frame\n${overflow.join('\n')}`)
    throw new Error('og image content outside frame')
  }

  const png = await page.screenshot({ type: 'png' })
  const out = new URL('public/og-image.png', root)
  await writeFile(out, png)
  console.log(`og_image=rendered bytes=${png.length} brand=${SITE_DEFAULTS.brandLatin} size=1200x630`)
} finally {
  await browser.close()
}
