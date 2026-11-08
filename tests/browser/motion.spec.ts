/*
 * Motion verification, run with animation ENABLED.
 *
 * The main suite pins reducedMotion: 'reduce' for determinism, which means it
 * never exercises the motion layer. These tests opt back in and assert both
 * directions: motion present when allowed, and fully absent when reduced.
 */
import { test, expect } from '@playwright/test'

test.use({ reducedMotion: 'no-preference' })

test('scroll reveal shows content and pointer tilt responds to the cursor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  const section = page.locator('.tools-section')
  await section.scrollIntoViewIfNeeded()
  // Revealed content must end up fully opaque, never stuck part-way.
  await expect(section).toHaveClass(/is-revealed/)
  await expect(section).toHaveCSS('opacity', '1')

  const card = page.locator('.tool-card').first()
  await card.scrollIntoViewIfNeeded()
  const box = await card.boundingBox()
  if (!box) throw new Error('card has no box')

  // Hover near a corner: the delegated handler should write tilt custom props.
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.25)
  await expect.poll(async () => card.evaluate((node) => node.style.getPropertyValue('--tilt-y'))).not.toBe('')
  const tilt = await card.evaluate((node) => Number.parseFloat(node.style.getPropertyValue('--tilt-y')))
  expect(Math.abs(tilt)).toBeGreaterThan(0)
  expect(Math.abs(tilt)).toBeLessThanOrEqual(2.5)

  // Moving off the cards must clear the inline state so nothing stays tilted.
  await page.mouse.move(5, 5)
  await expect.poll(async () => card.evaluate((node) => node.style.getPropertyValue('--tilt-y'))).toBe('')
})

test('reduced motion leaves every element visible and untilted', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')

  // Nothing may be hidden by the reveal layer when motion is reduced.
  for (const selector of ['.tools-section', '.dashboard-lower']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '1')
  }
  const card = page.locator('.tool-card').first()
  const box = await card.boundingBox()
  if (!box) throw new Error('card has no box')
  await page.mouse.move(box.x + box.width * 0.8, box.y + box.height * 0.3)
  expect(await card.evaluate((node) => node.style.getPropertyValue('--tilt-y'))).toBe('')
  expect(await card.evaluate((node) => getComputedStyle(node).transform)).toBe('none')
  expect(await page.locator('.sidebar .brand-mark-sheen').evaluate((node) => getComputedStyle(node).animationName)).toBe('none')
})

test('the celia.sh wordmark is present, readable and named in the tab title', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/celia\.sh/)
  await expect(page.locator('.sidebar .wordmark')).toHaveText('celia.sh')
  await expect(page.locator('.hero-wordmark')).toHaveText('celia.sh')
  await expect(page.getByRole('button', { name: 'celia.sh — الصفحة الرئيسية' })).toBeVisible()

  // Mobile hides the sidebar, so the top bar must carry the name instead.
  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.locator('.topbar-brand .wordmark')).toBeVisible()
  await expect(page.locator('.topbar-brand .wordmark')).toHaveText('celia.sh')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('mobile hero art never overlaps the hero copy', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  const copy = await page.locator('.hero-content').boundingBox()
  const art = await page.locator('.hero-art').boundingBox()
  if (!copy || !art) throw new Error('hero boxes missing')
  // Adding the brand line pushed the copy down; the art must stay clear of it.
  expect(art.y).toBeGreaterThanOrEqual(copy.y + copy.height)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
