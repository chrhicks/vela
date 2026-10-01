import { expect, test } from '@playwright/test'

const url = (width: number, mode = 'light', state = 'current') =>
  `/?component=panel&specimen=fieldroom-photographs&profile=fieldroom&mode=${mode}&context=isolated&viewport=${width + 66}&prop.preview=${state}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 2400, height: 3200 })
  await page.route('**/__workshop/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ session: null, profiles: [] }),
  }))
})

for (const width of [1440, 900, 390]) {
  for (const mode of ['light', 'dark']) {
    for (const state of ['current', 'unavailable']) {
      test(`Photographs ${width}px ${mode} ${state}`, async ({ page }, testInfo) => {
        await page.goto(url(width, mode, state))
        const demo = page.locator('.vela-photographs-demo')
        const viewer = demo.getByRole('region', { name: 'Selected photograph' })
        await expect(demo.locator('.vela-photographs-demo__pixels img')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await demo.locator('.vela-photographs-demo__pixels img').evaluate((image: HTMLImageElement) => image.decode())

        const geometry = await demo.evaluate(element => {
          const box = (selector: string) => {
            const rect = element.querySelector(selector)!.getBoundingClientRect()

            return { x: rect.x - element.getBoundingClientRect().x, y: rect.y - element.getBoundingClientRect().y, width: rect.width, height: rect.height }
          }

          return {
            width: element.clientWidth, overflow: element.scrollWidth > element.clientWidth,
            list: box('.vela-photographs-demo__list'), viewer: box('.vela-photographs-demo__viewer'),
            details: box('.vela-photographs-demo__details'), pixels: box('.vela-photographs-demo__pixels'),
          }
        })

        expect(geometry.width).toBe(width)
        expect(geometry.overflow).toBe(false)
        await expect(viewer).toHaveCount(1)
        await expect(demo.getByRole('button', { name: 'Download original FITS ↓' })).toHaveCount(1)

        if (state === 'unavailable') {
          await expect(demo.getByRole('heading', { name: 'Showing the original preview' })).toBeVisible()
          await expect(demo.getByRole('button', { name: 'Download original PNG ↓' })).toBeVisible()
        }

        if (width === 1440) {
          expect(geometry.list.width).toBe(260)
          expect(geometry.viewer.width).toBe(736)
          expect(geometry.details.width).toBe(324)
          expect(geometry.pixels.height).toBe(532)
        } else if (width === 900) {
          expect(geometry.details.x).toBe(geometry.viewer.x)
          expect(geometry.details.y).toBeGreaterThan(geometry.viewer.y)
        } else {
          expect(geometry.viewer.x).toBe(20)
          expect(geometry.viewer.width).toBe(350)
          expect(geometry.list.x).toBe(20)
          expect(geometry.details.x).toBe(20)
          expect(geometry.viewer.y).toBeLessThan(geometry.details.y)
          expect(geometry.details.y).toBeLessThan(geometry.list.y)
          await expect(demo.getByRole('button', { name: 'Jump to photographs ↓' })).toBeVisible()
        }

        await testInfo.attach('geometry', { body: JSON.stringify(geometry, null, 2), contentType: 'application/json' })
        await demo.screenshot({ path: testInfo.outputPath(`photographs-${width}-${mode}-${state}.png`) })
      })
    }
  }
}

test('compact selection, earlier disclosure and fallback preserve one selected viewer', async ({ page }) => {
  await page.goto(url(390))
  const demo = page.locator('.vela-photographs-demo')
  const rows = demo.locator('.vela-photographs-demo__rows a')
  await expect(rows).toHaveCount(6)
  await demo.getByRole('button', { name: 'Jump to photographs ↓' }).click()
  await expect(demo.getByRole('heading', { name: '30 September 2026' })).toBeFocused()
  await rows.nth(2).click()
  await expect(page).toHaveURL(/prop.selected=2/)
  await expect(demo.getByRole('region', { name: 'Selected photograph' })).toBeFocused()
  await expect(demo.getByText('Selected · 21:32:56')).toBeVisible()
  await demo.getByRole('button', { name: 'Show 6 earlier images' }).click()
  await expect(rows).toHaveCount(12)
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(demo.getByRole('heading', { name: '30 September 2026' })).toBeFocused()
  await page.reload()
  await expect(rows).toHaveCount(12)
  await expect(rows.nth(2)).toHaveAttribute('aria-current', 'true')
  await expect(demo.getByRole('region', { name: 'Selected photograph' })).toHaveCount(1)
})
