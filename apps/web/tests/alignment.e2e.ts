import { expect, test } from '@playwright/test'
import type { AlignmentView } from '@vela/model/web'

for (const width of [1100, 390]) {
  test(`physical alignment preserves preparation and image provenance at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 })

    const view: AlignmentView = {
      mode: 'physical',
      cameraName: 'ASI2600MC Pro',
      rigId: 'rig-1',
      rigName: 'Askar FRA 400',
      enabled: true,
      unavailableReason: null,
      phase: 'setup',
      activity: 'idle',
      active: false,
      position: 0,
      solvedPositions: 0,
      exposureSeconds: 3,
      exposureStartedAt: null,
      measuredAt: null,
      warning: null,
      error: null,
      measurement: null,
    }

    await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: view }))
    await page.goto('/rigs/rig-1/observe/alignment')
    await expect(page.getByText('ASI2600MC Pro')).toBeVisible()
    await expect(page.getByText('Dec +80° · consistent starting field')).toBeVisible()
    await expect(
      page.getByText(/Each attempt homes, then moves to a consistent starting field at Dec \+80°/),
    ).toBeVisible()
    await expect(
      page.getByText(
        /Allow up to 120° total westward travel and 1° on either side for the direction check/,
      ),
    ).toBeVisible()
    await expect(page.getByText(/Use sidereal tracking/)).toBeVisible()
    await expect(page.locator('.vela-alignment')).not.toContainText('simulator')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.evaluate(() => document.fonts.ready)
    const preparation = page.locator('.vela-polar-baseline__next p').last()
    await expect(preparation).toContainText('You can stop at any time.')

    const textBounds = await preparation.evaluate(element => {
      const range = document.createRange()
      range.selectNodeContents(element)

      return {
        textBottom: range.getBoundingClientRect().bottom,
        paragraphBottom: element.getBoundingClientRect().bottom,
      }
    })

    expect(textBounds.textBottom).toBeLessThanOrEqual(textBounds.paragraphBottom)
    await page.screenshot({ path: `/tmp/alignment-app-setup-${width}.png`, fullPage: true })

    await page.route('**/api/alignment-fixture.png', route =>
      route.fulfill({
        contentType: 'image/png',
        body: Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=',
          'base64',
        ),
      }),
    )
    Object.assign(view, {
      phase: 'adjusting',
      active: true,
      activity: 'waiting',
      measuredAt: new Date().toISOString(),
      measurement: {
        capturedAtSource: 'server-estimate',
        altitudeArcsec: 9,
        azimuthArcsec: 11,
        totalArcsec: 14,
        solvedAt: '2026-09-21T01:00:30Z',
        imageUrl: '/api/alignment-fixture.png',
        fitImageUrl: '/api/alignment-fixture.png',
        frameId: '/api/alignment-fixture.png',
        fitImageScale: 1,
        imageWidth: 640,
        imageHeight: 400,
        targetX: 310,
        targetY: 190,
        fieldHeightDegrees: 1,
      },
    })
    await page.getByRole('button', { name: 'Enlarge image' }).click()
    await expect(page.getByRole('dialog')).toContainText('Estimated exposure start')
    await page.keyboard.press('Escape')
    await expect(page.getByText(/Adjust the mount manually/)).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/alignment-app-adjusting-${width}.png`, fullPage: true })

    Object.assign(view, {
      activity: 'retrying',
      warning: 'Device connection interrupted. Retrying automatically.',
    })
    await expect(page.getByText('Measurements interrupted', { exact: true })).toBeVisible()
    await expect(page.locator('.vela-polar-status')).toContainText('Retrying camera reads')
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(/Wait for a fresh measurement before adjusting/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Stop session' })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/alignment-app-reconnecting-${width}.png`, fullPage: true })
    Object.assign(view, { activity: 'waiting', warning: null })
    await expect(page.getByRole('alert')).toHaveCount(0)
    await expect(page.getByText(/Adjust the mount manually/)).toBeVisible()

    Object.assign(view, { mode: 'offline', phase: 'setup', active: false, measurement: null })
    await expect(page.getByText(/simulator’s large-error preset/)).toBeVisible()
    await expect(page.getByText('Configured sky patch')).toBeVisible()
  })
}

for (const width of [1100, 390]) {
  test(`baseline exposure stays visible when plate solving fails at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1100 })

    const view: AlignmentView = {
      mode: 'physical',
      cameraName: 'ASI2600MC Pro',
      rigId: 'rig-1',
      rigName: 'Askar FRA 400',
      enabled: true,
      unavailableReason: null,
      phase: 'baseline',
      activity: 'solving',
      active: true,
      position: 1,
      solvedPositions: 0,
      exposureSeconds: 3,
      exposureStartedAt: null,
      measuredAt: null,
      warning: null,
      error: null,
      measurement: null,
      preview: {
        imageUrl: '/api/baseline-fixture.png',
        fitImageUrl: '/api/baseline-fixture.png',
        frameId: '/api/baseline-fixture.png',
        fitImageScale: 1,
        imageWidth: 640,
        imageHeight: 400,
        capturedAt: '2026-09-15T00:25:49Z',
        capturedAtSource: 'server-estimate',
        position: 1,
      },
    }

    await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: view }))
    await page.route('**/api/baseline-fixture.png', route =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#090e18"/><circle cx="100" cy="80" r="2" fill="white"/><circle cx="580" cy="360" r="2" fill="white"/></svg>',
      }),
    )
    await page.goto('/rigs/rig-1/observe/alignment')
    const image = page.getByRole('img', { name: 'Latest camera exposure at baseline position 1' })
    await expect(image).toBeVisible()
    await expect
      .poll(() =>
        image.evaluate(element => (element instanceof HTMLImageElement ? element.naturalWidth : 0)),
      )
      .toBeGreaterThan(0)
    const bounds = await image.boundingBox()
    expect(bounds!.width / bounds!.height).toBeCloseTo(640 / 400, 2)
    await expect(page.getByRole('button', { name: 'Full frame', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Enlarge image' }).click()
    await expect(page.getByRole('dialog').locator('time')).toHaveAttribute(
      'datetime',
      view.preview!.capturedAt,
    )
    await expect(page.getByRole('dialog')).toContainText('Estimated exposure start')
    await page.keyboard.press('Escape')
    await expect(page.getByRole('img', { name: /alignment target/ })).toHaveCount(0)
    Object.assign(view, {
      phase: 'stopped',
      activity: 'idle',
      active: false,
      warning: 'No plate-solve solution',
    })
    await expect(page.getByText('Plate-solving failed', { exact: true })).toBeVisible()
    await expect(image).toBeVisible()
    await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `/tmp/alignment-baseline-failed-${width}.png`, fullPage: true })
  })
}

test('stopped baseline preview recovers from a failed image request without another capture', async ({
  page,
}) => {
  const view: AlignmentView = {
    mode: 'physical',
    rigId: 'rig-1',
    rigName: 'Askar FRA 400',
    enabled: true,
    unavailableReason: null,
    phase: 'baseline',
    activity: 'solving',
    active: true,
    position: 1,
    solvedPositions: 0,
    exposureSeconds: 3,
    exposureStartedAt: null,
    measuredAt: null,
    warning: null,
    error: null,
    measurement: null,
    preview: {
      imageUrl: '/api/retry-fixture.png',
      fitImageUrl: '/api/retry-fixture.png',
      frameId: '/api/retry-fixture.png',
      fitImageScale: 1,
      imageWidth: 640,
      imageHeight: 400,
      capturedAt: '2026-09-15T00:25:49Z',
      capturedAtSource: 'camera',
      position: 1,
    },
  }

  let requests = 0

  await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: view }))
  await page.route('**/api/retry-fixture.png', async route => {
    requests++

    if (requests === 1) return route.abort('connectionreset')

    // A slow successful retry must finish rather than being remounted again.
    await new Promise(resolve => setTimeout(resolve, 2000))

    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#090e18"/></svg>',
    })
  })
  await page.goto('/rigs/rig-1/observe/alignment')
  await expect(page.getByText('The exposure preview could not be loaded. Retrying…')).toBeVisible()
  Object.assign(view, {
    phase: 'stopped',
    activity: 'idle',
    active: false,
    warning: 'No plate-solve solution',
  })
  await expect(page.getByRole('button', { name: 'Start again' })).toBeVisible()
  const image = page.getByRole('img', { name: 'Latest camera exposure at baseline position 1' })
  await expect
    .poll(() =>
      image.evaluate(element => (element instanceof HTMLImageElement ? element.naturalWidth : 0)),
    )
    .toBe(640)
  await expect(page.getByText('The exposure preview could not be loaded. Retrying…')).toHaveCount(0)
  await expect(image).toHaveAttribute('src', '/api/retry-fixture.png')
  await page.getByRole('button', { name: 'Enlarge image' }).click()
  await expect(page.getByRole('dialog').locator('time')).toHaveAttribute(
    'datetime',
    '2026-09-15T00:25:49Z',
  )
  expect(requests).toBe(2)
})

test('unknown alignment Stop waits for a terminal observation before another command', async ({
  page,
}) => {
  let reads = 0
  let writes = 0
  let stopped = false

  const view: AlignmentView = {
    rigId: 'rig-1',
    rigName: 'Askar FRA 400',
    mode: 'physical',
    cameraName: 'Review camera',
    enabled: true,
    unavailableReason: null,
    phase: 'baseline',
    activity: 'exposing',
    active: true,
    position: 1,
    solvedPositions: 0,
    exposureSeconds: 2,
    exposureStartedAt: null,
    measuredAt: null,
    measurement: null,
    preview: null,
    warning: null,
    error: null,
  }

  await page.route('**/api/web/rigs/rig-1/alignment', route => {
    reads++

    return route.fulfill({
      json: stopped ? { ...view, active: false, phase: 'stopped', activity: 'idle' } : view,
    })
  })
  await page.route('**/api/rigs/rig-1/alignment/stop', route => {
    writes++

    return route.fulfill({ status: 503, json: { error: 'response-lost' } })
  })
  await page.goto('/rigs/rig-1/observe/alignment')
  const stop = page.getByRole('button', { name: 'Stop measurement', exact: true })
  await stop.click()
  await expect(page.getByText(/The command was not repeated/)).toBeVisible()
  const readsAfterLoss = reads
  await expect.poll(() => reads).toBeGreaterThan(readsAfterLoss + 1)
  await expect(stop).toBeDisabled()
  expect(writes).toBe(1)
  stopped = true
  await expect(page.getByRole('button', { name: 'Start again', exact: true })).toBeEnabled()
  await expect(page.getByText(/The command was not repeated/)).toHaveCount(0)
  expect(writes).toBe(1)
})
