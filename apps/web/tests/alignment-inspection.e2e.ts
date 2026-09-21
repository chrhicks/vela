import { expect, test } from '@playwright/test'
import type { AlignmentView } from '@vela/model/web'
import { fileURLToPath } from 'node:url'

const imagePath = fileURLToPath(new URL('../../../packages/ui/src/components/fixtures/capture-star-field.png', import.meta.url))

const capturedAt = '2026-09-21T01:00:00Z'

const imageUrl = '/api/alignment-inspection-original.png'

function initialView(): AlignmentView {
  return {
    rigId: 'rig-1', rigName: 'Askar FRA 400 · inspection fixture', mode: 'physical',
    enabled: true, unavailableReason: null, phase: 'adjusting', activity: 'waiting', active: true,
    position: 3, solvedPositions: 3, exposureSeconds: 2, exposureStartedAt: null,
    measuredAt: capturedAt, warning: null, error: null,
    measurement: { imageUrl, imageWidth: 1600, imageHeight: 1200, fieldHeightDegrees: 2,
      capturedAtSource: 'server-estimate', totalArcsec: 503, azimuthArcsec: -440, altitudeArcsec: -244,
      targetX: 726.1667, targetY: 558.8333 },
  }
}

for (const width of [390, 1040]) {
  test(`alignment inspection uses projected coordinates and pins the enlarged exposure at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.clock.setFixedTime(new Date('2026-09-21T01:00:08Z'))
    const state = initialView()
    const writes: string[] = []
    let offline = false
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') writes.push(route.request().url())

      return route.fulfill({ json: {} })
    })
    await page.route('**/api/web/rigs/rig-1/alignment', route => offline ? route.abort() : route.fulfill({ json: state }))
    await page.route('**/api/alignment-inspection-*.png', route => route.fulfill({ path: imagePath }))
    await page.goto('/rigs/rig-1/observe/alignment')
    const inspection = page.locator('.vela-polar-image')
    await expect(inspection.getByRole('button', { name: 'Fit both', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(inspection.locator('[data-marker="target"] circle')).toHaveAttribute('cx', '726.1667')
    await expect(inspection.locator('.vela-polar-inspection-status')).toContainText('8 s ago')
    await page.screenshot({ path: `test-results/alignment-production-${width}-large.png`, fullPage: true })

    for (const [name, targetX, targetY] of [['near', 801.3333, 601], ['outside', -300, 599.5]] as const) {
      state.measurement = { ...state.measurement!, targetX, targetY, imageUrl: `/api/alignment-inspection-${name}.png`,
        totalArcsec: name === 'near' ? 14 : 6597, azimuthArcsec: name === 'near' ? -11 : -6597, altitudeArcsec: name === 'near' ? -9 : 0 }
      await expect(inspection.locator('[data-marker="target"] circle')).toHaveAttribute('cx', String(targetX))
      await expect(inspection.getByRole('button', { name: 'Fit both', exact: true })).toHaveAttribute('aria-pressed', 'true')
      expect(await inspection.getByRole('img').evaluate(element => {
        if (!(element instanceof SVGSVGElement)) throw new Error('Expected solved-image SVG')

        const box = element.viewBox.baseVal

        return [...element.querySelectorAll('circle')].every(marker => marker.cx.baseVal.value > box.x && marker.cx.baseVal.value < box.x + box.width)
      })).toBe(true)
      await page.screenshot({ path: `test-results/alignment-production-${width}-${name}.png`, fullPage: true })
    }

    await expect(inspection).toContainText('Target outside captured image')
    await inspection.getByRole('button', { name: 'Fine · 1′' }).click()
    await expect(inspection).toContainText('Markers outside this fine view')
    await inspection.getByRole('button', { name: 'Enlarge image' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(dialog.locator('svg image')).toHaveAttribute('href', '/api/alignment-inspection-outside.png')
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    const native = dialog.getByRole('img')
    expect(await native.evaluate(element => element.getBoundingClientRect().width)).toBe(1600)
    await dialog.getByRole('region').evaluate(element => { element.scrollLeft = 400 })
    expect(await dialog.getByRole('region').evaluate(element => element.scrollLeft)).toBe(400)
    await page.screenshot({ path: `test-results/alignment-production-${width}-native.png`, fullPage: true })

    state.activity = 'retrying'
    state.warning = 'Device reads interrupted'
    await expect(dialog).toContainText('Retrying; pause adjustments')
    await expect(native).toHaveAttribute('src', '/api/alignment-inspection-outside.png')
    state.measuredAt = '2026-09-21T01:00:07Z'
    state.measurement = { ...state.measurement!, imageUrl: '/api/alignment-inspection-new.png' }
    await expect(inspection.locator('figcaption time')).toHaveAttribute('datetime', state.measuredAt)
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(native).toHaveAttribute('src', '/api/alignment-inspection-outside.png')
    await expect(dialog).toContainText('8 s ago')
    offline = true
    await expect(dialog).toContainText('Connection interrupted; pause adjustments')
    await expect(native).toHaveAttribute('src', '/api/alignment-inspection-outside.png')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(inspection.getByRole('button', { name: 'Enlarge image' })).toBeFocused()
    await expect(page.getByRole('button', { name: 'Stop to reposition' })).toBeDisabled()
    offline = false
    await expect(page.getByRole('button', { name: 'Stop to reposition' })).toBeEnabled()
    expect(writes).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })

  test(`baseline enlargement survives completion without changing exposure, viewport or focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.clock.setFixedTime(new Date('2026-09-21T01:00:08Z'))
    const state = initialView()
    Object.assign(state, { phase: 'baseline', measurement: null, measuredAt: null, position: 3,
      solvedPositions: 2, warning: 'No plate-solve solution', activity: 'exposing',
      preview: { imageUrl, imageWidth: 1600, imageHeight: 1200, capturedAt, capturedAtSource: 'camera', position: 3 } })
    const writes: string[] = []
    await page.route('**/api/**', route => {
      if (route.request().method() !== 'GET') writes.push(route.request().url())

      return route.fulfill({ json: {} })
    })
    await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: state }))
    await page.route('**/api/alignment-inspection-*.png', route => route.fulfill({ path: imagePath }))
    await page.goto('/rigs/rig-1/observe/alignment')
    await page.getByRole('button', { name: 'Enlarge image' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('No solution · Exposure retained')
    await expect(dialog.locator('.vela-polar-angular-scale')).toHaveCount(0)
    await expect(dialog.locator('[data-marker]')).toHaveCount(0)
    await expect(dialog.getByRole('img')).toHaveAttribute('src', imageUrl)
    await page.screenshot({ path: `test-results/alignment-production-${width}-baseline.png`, fullPage: true })
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    await expect(dialog.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await dialog.getByRole('region').evaluate(element => { element.scrollLeft = 400 })
    Object.assign(state, initialView(), { measuredAt: '2026-09-21T01:00:07Z' })
    state.measurement = { ...state.measurement!, imageUrl: '/api/alignment-inspection-adjustment.png' }
    await expect(page.locator('.vela-polar-readings')).toBeVisible()
    await expect(page.locator('.vela-polar-image svg image')).toHaveAttribute('href', state.measurement.imageUrl)
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(dialog.getByRole('button', { name: '100%', exact: true })).toBeFocused()
    expect(await dialog.getByRole('region').evaluate(element => element.scrollLeft)).toBe(400)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Enlarge image' })).toBeFocused()
    expect(writes).toEqual([])
  })
}
