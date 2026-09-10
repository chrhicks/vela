import { expect, test } from '@playwright/test'
import type { AlignmentView } from '@vela/model/web'

for (const width of [1100, 390]) {
  test(`physical alignment preserves preparation and image provenance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })

    const view: AlignmentView = {
      mode: 'physical', cameraName: 'ASI2600MC Pro', rigId: 'rig-1', rigName: 'Askar FRA 400',
      enabled: true, unavailableReason: null, phase: 'setup', activity: 'idle', active: false,
      position: 0, solvedPositions: 0, exposureSeconds: 3, exposureStartedAt: null,
      measuredAt: null, warning: null, error: null, measurement: null,
    }

    await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: view }))
    await page.goto('/rigs/rig-1/observe/alignment')
    await expect(page.getByText('ASI2600MC Pro')).toBeVisible()
    await expect(page.getByText('Dec +80° · consistent starting field')).toBeVisible()
    await expect(page.getByText(/Each attempt homes, then moves to a consistent starting field at Dec \+80°/)).toBeVisible()
    await expect(page.getByText(/Allow up to 120° total westward travel and 1° on either side for the direction check/)).toBeVisible()
    await expect(page.getByText(/Use sidereal tracking/)).toBeVisible()
    await expect(page.locator('.vela-alignment')).not.toContainText('simulator')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => document.fonts.ready)
    const preparation = page.locator('.vela-polar-baseline__next p').last()
    await expect(preparation).toContainText('You can stop at any time.')

    const textBounds = await preparation.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)

      return { textBottom: range.getBoundingClientRect().bottom, paragraphBottom: element.getBoundingClientRect().bottom }
    })

    expect(textBounds.textBottom).toBeLessThanOrEqual(textBounds.paragraphBottom)
    await page.screenshot({ path: `/tmp/alignment-app-setup-${width}.png`, fullPage: true })

    await page.route('**/api/alignment-fixture.png', route => route.fulfill({
      contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=', 'base64'),
    }))
    Object.assign(view, { phase: 'adjusting', active: true, activity: 'waiting', measuredAt: new Date().toISOString(), measurement: {
      capturedAtSource: 'server-estimate', altitudeArcsec: 9, azimuthArcsec: 11, totalArcsec: 14,
      imageUrl: '/api/alignment-fixture.png', imageWidth: 640, imageHeight: 400,
      targetX: 310, targetY: 190, fieldHeightDegrees: 1,
    } })
    await expect(page.getByText(/Estimated exposure start/)).toBeVisible()
    await expect(page.getByText(/Adjust the mount’s altitude and azimuth knobs/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/alignment-app-adjusting-${width}.png`, fullPage: true })

    Object.assign(view, { mode: 'offline', phase: 'setup', active: false, measurement: null })
    await expect(page.getByText(/simulator’s large-error preset/)).toBeVisible()
    await expect(page.getByText('Configured sky patch')).toBeVisible()
  })
}
