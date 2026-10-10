import { expect, test } from '@playwright/test'
import type { AlignmentView } from '@vela/model/web'
import { fileURLToPath } from 'node:url'

const imagePath = fileURLToPath(
  new URL('../../../packages/ui/src/components/fixtures/capture-star-field.png', import.meta.url),
)

const capturedAt = '2026-09-21T01:00:00Z'

const imageUrl = '/api/alignment-inspection-original.png'

function initialView(): AlignmentView {
  return {
    rigId: 'rig-1',
    rigName: 'Askar FRA 400 · inspection fixture',
    mode: 'physical',
    enabled: true,
    unavailableReason: null,
    phase: 'adjusting',
    activity: 'waiting',
    active: true,
    position: 3,
    solvedPositions: 3,
    exposureSeconds: 2,
    exposureStartedAt: null,
    measuredAt: capturedAt,
    warning: null,
    error: null,
    measurement: {
      imageUrl,
      fitImageUrl: imageUrl,
      frameId: imageUrl,
      fitImageScale: 1,
      imageWidth: 1600,
      imageHeight: 1200,
      fieldHeightDegrees: 2,
      capturedAtSource: 'server-estimate',
      totalArcsec: 503,
      solvedAt: '2026-09-21T01:00:30Z',
      azimuthArcsec: -440,
      altitudeArcsec: -244,
      targetX: 726.1667,
      targetY: 558.8333,
    },
  }
}

for (const width of [390, 1040]) {
  test(`alignment inspection uses projected coordinates and pins the enlarged exposure at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.clock.setFixedTime(new Date('2026-09-21T01:00:08Z'))
    const state = initialView()
    const writes: string[] = []
    let offline = false
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET') writes.push(route.request().url())

      return route.fulfill({ json: {} })
    })
    await page.route('**/api/web/rigs/rig-1/alignment', (route) =>
      offline ? route.abort() : route.fulfill({ json: state }),
    )
    await page.route('**/api/alignment-inspection-*.png', (route) =>
      route.fulfill({ path: imagePath }),
    )
    await page.goto('/rigs/rig-1/observe/alignment')
    const inspection = page.locator('.vela-polar-image')
    await expect(inspection.getByRole('button', { name: 'Fit both', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(inspection.locator('[data-marker="target"] circle').first()).toHaveAttribute(
      'cx',
      '726.1667',
    )
    await expect(inspection.locator('.vela-polar-inspection-status')).toHaveText(
      'Last solved frame',
    )
    await expect(inspection.getByRole('button', { name: '100%', exact: true })).toHaveCount(0)
    await expect(inspection.locator('time')).toHaveCount(0)
    await expect(inspection.locator('[data-marker="reference"]')).toHaveAttribute('cx', '799.5')
    await expect(inspection.locator('[data-marker="reference"]')).toHaveAttribute('cy', '599.5')
    await expect(inspection.locator('[data-marker="reference-crosshair"]')).toHaveCount(1)
    await expect
      .poll(async () =>
        inspection
          .locator('[data-marker="target"] circle')
          .first()
          .evaluate((element) => element.getBoundingClientRect().width),
      )
      .toBeCloseTo(26, 1)
    await page.screenshot({
      path: `test-results/alignment-production-${width}-large.png`,
      fullPage: true,
    })

    for (const [name, targetX, targetY] of [
      ['near', 801.3333, 601],
      ['outside', -300, 599.5],
    ] as const) {
      state.measurement = {
        ...state.measurement!,
        targetX,
        targetY,
        imageUrl: `/api/alignment-inspection-${name}.png`,
        fitImageUrl: `/api/alignment-inspection-${name}.png`,
        frameId: `/api/alignment-inspection-${name}.png`,
        fitImageScale: 1,
        totalArcsec: name === 'near' ? 14 : 6597,
        solvedAt: '2026-09-21T01:00:30Z',
        azimuthArcsec: name === 'near' ? -11 : -6597,
        altitudeArcsec: name === 'near' ? -9 : 0,
      }
      await expect(inspection.locator('[data-marker="target"] circle').first()).toHaveAttribute(
        'cx',
        String(targetX),
      )
      await expect(
        inspection.getByRole('button', { name: 'Fit both', exact: true }),
      ).toHaveAttribute('aria-pressed', 'true')
      expect(
        await inspection.getByRole('img').evaluate((element) => {
          if (!(element instanceof SVGSVGElement)) throw new Error('Expected solved-image SVG')

          const box = element.viewBox.baseVal

          return [...element.querySelectorAll('circle')].every(
            (marker) =>
              marker.cx.baseVal.value > box.x && marker.cx.baseVal.value < box.x + box.width,
          )
        }),
      ).toBe(true)
      await page.screenshot({
        path: `test-results/alignment-production-${width}-${name}.png`,
        fullPage: true,
      })
    }

    await expect(inspection).toContainText('Target outside captured image')
    await inspection.getByRole('button', { name: 'Fine · 1′' }).click()
    await expect(inspection).toContainText('Markers outside this fine view')
    await inspection.getByRole('button', { name: 'Enlarge image' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(dialog.locator('svg image')).toHaveAttribute(
      'href',
      '/api/alignment-inspection-outside.png',
    )
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    const native = dialog.getByRole('img')
    expect(await native.evaluate((element) => element.getBoundingClientRect().width)).toBe(1600)
    await dialog.getByRole('region').evaluate((element) => {
      element.scrollLeft = 400
    })
    expect(await dialog.getByRole('region').evaluate((element) => element.scrollLeft)).toBe(400)
    await page.screenshot({
      path: `test-results/alignment-production-${width}-native.png`,
      fullPage: true,
    })

    state.activity = 'retrying'
    state.warning = 'Device reads interrupted'
    await expect(dialog).toContainText('Retrying; pause adjustments')
    await expect(native).toHaveAttribute('src', '/api/alignment-inspection-outside.png')
    state.measuredAt = '2026-09-21T01:00:07Z'
    state.measurement = {
      ...state.measurement!,
      imageUrl: '/api/alignment-inspection-new.png',
      fitImageUrl: '/api/alignment-inspection-new.png',
      frameId: '/api/alignment-inspection-new.png',
    }
    await expect(inspection.locator('svg image')).toHaveAttribute(
      'href',
      state.measurement.imageUrl,
    )
    await expect(inspection.locator('.vela-polar-inspection-status')).toContainText('1 seconds old')
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(native).toHaveAttribute('src', '/api/alignment-inspection-outside.png')
    await expect(dialog).toContainText('8 seconds old')
    offline = true
    await expect(dialog).toContainText('Connection interrupted; pause adjustments')
    await expect(native).toHaveAttribute('src', '/api/alignment-inspection-outside.png')
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(inspection.getByRole('button', { name: 'Enlarge image' })).toBeFocused()
    await expect(page.getByRole('button', { name: /^Stop(?: session)?$/ })).toBeDisabled()
    offline = false
    await expect(page.getByRole('button', { name: /^Stop(?: session)?$/ })).toBeEnabled()
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    await page.getByRole('radio', { name: 'Dark', exact: true }).click()
    await page.getByRole('button', { name: 'Close appearance' }).click()
    await expect(inspection.getByRole('button', { name: 'Fine · 1′' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await expect(inspection.locator('svg image')).toHaveAttribute(
      'href',
      state.measurement.imageUrl,
    )
    await expect(inspection.locator('[data-marker="reference"]')).toHaveCSS(
      'stroke',
      'rgb(241, 238, 229)',
    )
    await expect(inspection.locator('[data-marker="target"] circle').first()).toHaveCSS(
      'stroke',
      'rgb(226, 213, 155)',
    )
    expect(writes).toEqual([])

    const overflow = await page.evaluate(() => ({
      width: innerWidth,
      document: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('main *')].flatMap(element => {
        const right = element.getBoundingClientRect().right

        if (element.closest('svg') || right <= innerWidth) return []

        return [{ className: element.className, right }]
      }),
    }))

    expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width)
  })

  test(`baseline enlargement survives completion without changing exposure, viewport or focus at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 })
    await page.clock.setFixedTime(new Date('2026-09-21T01:00:08Z'))
    const state = initialView()
    Object.assign(state, {
      phase: 'baseline',
      measurement: null,
      measuredAt: null,
      position: 3,
      solvedPositions: 2,
      warning: 'No plate-solve solution',
      activity: 'exposing',
      preview: {
        imageUrl,
        fitImageUrl: imageUrl,
        frameId: imageUrl,
        fitImageScale: 1,
        imageWidth: 1600,
        imageHeight: 1200,
        capturedAt,
        capturedAtSource: 'camera',
        position: 3,
      },
    })
    const writes: string[] = []
    await page.route('**/api/**', (route) => {
      if (route.request().method() !== 'GET') writes.push(route.request().url())

      return route.fulfill({ json: {} })
    })
    await page.route('**/api/web/rigs/rig-1/alignment', (route) => route.fulfill({ json: state }))
    await page.route('**/api/alignment-inspection-*.png', (route) =>
      route.fulfill({ path: imagePath }),
    )
    await page.goto('/rigs/rig-1/observe/alignment')
    await page.getByRole('button', { name: 'Enlarge image' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toContainText('No solution · Exposure retained')
    await expect(dialog.locator('.vela-polar-angular-scale')).toHaveCount(0)
    await expect(dialog.locator('[data-marker]')).toHaveCount(0)
    await expect(dialog.getByRole('img')).toHaveAttribute('src', imageUrl)
    await page.screenshot({
      path: `test-results/alignment-production-${width}-baseline.png`,
      fullPage: true,
    })
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    await expect(dialog.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await dialog.getByRole('region').evaluate((element) => {
      element.scrollLeft = 400
    })
    Object.assign(state, initialView(), { measuredAt: '2026-09-21T01:00:07Z' })
    state.measurement = {
      ...state.measurement!,
      imageUrl: '/api/alignment-inspection-adjustment.png',
      fitImageUrl: '/api/alignment-inspection-adjustment.png',
      frameId: '/api/alignment-inspection-adjustment.png',
      fitImageScale: 1,
    }
    await expect(page.locator('.vela-polar-total')).toBeVisible()
    await expect(page.locator('.vela-polar-image svg image')).toHaveAttribute(
      'href',
      state.measurement.imageUrl,
    )
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(dialog.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(dialog.getByRole('button', { name: '100%', exact: true })).toBeFocused()
    expect(await dialog.getByRole('region').evaluate((element) => element.scrollLeft)).toBe(400)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Enlarge image' })).toBeFocused()
    expect(writes).toEqual([])
  })
}

test('alignment feedback uses the fit image and native detail, fetching the native image only for 100%', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1040, height: 1100 })
  await page.clock.setFixedTime(new Date('2026-09-21T01:00:08Z'))
  const base = '/api/rigs/rig-1/alignment/images/frame-7'
  const state = initialView()
  state.measurement = {
    ...state.measurement!,
    frameId: 'frame-7',
    imageUrl: base,
    fitImageUrl: `${base}/fit`,
    fitImageScale: 4,
    imageWidth: 1601,
    imageHeight: 1201,
    detail: { imageUrl: `${base}/detail`, x: 500, y: 330, width: 520, height: 520 },
  }
  const requested: string[] = []
  await page.route('**/api/**', (route) => route.fulfill({ json: {} }))
  await page.route('**/api/web/rigs/rig-1/alignment', (route) => route.fulfill({ json: state }))
  await page.route(`**${base}**`, (route) => {
    requested.push(new URL(route.request().url()).pathname)

    return route.fulfill({ path: imagePath })
  })
  await page.goto('/rigs/rig-1/observe/alignment')
  const images = page.locator('.vela-polar-image svg image')
  await expect(images).toHaveCount(2)
  // Each fit pixel covers four native pixels from the origin, so 1601 rounds up to 1604.
  await expect(images.nth(0)).toHaveAttribute('href', `${base}/fit`)
  await expect(images.nth(0)).toHaveAttribute('width', '1604')
  await expect(images.nth(0)).toHaveAttribute('height', '1204')
  await expect(images.nth(1)).toHaveAttribute('href', `${base}/detail`)
  await expect(images.nth(1)).toHaveAttribute('x', '500')
  await expect(images.nth(1)).toHaveAttribute('y', '330')
  await expect(images.nth(1)).toHaveAttribute('width', '520')

  await page.getByRole('button', { name: 'Full frame', exact: true }).first().click()
  await expect(images).toHaveCount(1)
  expect(requested).not.toContain(base)

  await page.getByRole('button', { name: 'Enlarge image' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '100%', exact: true }).click()
  await expect(dialog.getByRole('img')).toHaveAttribute('src', base)
  await expect.poll(() => requested).toContain(base)
  await expect(dialog.getByText('Loading full-resolution image…')).toHaveCount(0)
})
