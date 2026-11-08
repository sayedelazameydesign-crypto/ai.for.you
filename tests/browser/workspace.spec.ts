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
