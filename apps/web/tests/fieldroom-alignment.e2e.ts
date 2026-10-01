import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { reviewTimezone } from './fixtures/fieldroom/tonight'
import { openAlignmentScene } from './fixtures/fieldroom/browser'
import type { AlignmentScene } from './fixtures/fieldroom/alignment'

test.use({ timezoneId: reviewTimezone })

for (const width of [1440, 768, 390]) {
  for (const mode of ['light', 'dark'] as const) {
    for (const name of ['alignment-phone-adjusting', 'alignment-phone-read-interrupted'] as const) {
      test(`alignment reference ${name} ${width} ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 782 : 900 })
        await page.emulateMedia({ reducedMotion: 'reduce' })
        const { scene } = await openAlignmentScene(page, name)

        if (mode === 'dark') {
          await page.getByRole('button', { name: 'Appearance', exact: true }).click()
          await page.getByRole('radio', { name: 'Dark', exact: true }).check()
          await page.keyboard.press('Escape')
        }

        await expect(page.locator('[data-mode]').first()).toHaveAttribute('data-mode', mode)
        await expect(page.locator('.vela-polar-total strong')).toHaveText('38″')
        await expect(page.locator('.vela-polar-image svg image')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await page.locator('h1').click()
        await page.mouse.move(0, 0)

        const geometry = await page.evaluate(
          selectors => ({
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX, scrollY },
            coordinateSpace: 'document',
            mode: document.documentElement.dataset.mode,
            elements: selectors.flatMap(selector =>
              Array.from(document.querySelectorAll(selector)).map(element => {
                const rect = element.getBoundingClientRect()
                const style = getComputedStyle(element)

                return {
                  selector,
                  x: rect.x + scrollX,
                  y: rect.y + scrollY,
                  width: rect.width,
                  height: rect.height,
                  font: style.font,
                  gap: style.gap,
                  color: style.color,
                  background: style.backgroundColor,
                }
              }),
            ),
          }),
          [
            'h1',
            '.vela-polar-layout',
            '.vela-polar-status',
            '.vela-polar-total',
            '.vela-polar-image',
            '.vela-polar-actions',
            '.vela-polar-image svg',
          ],
        )

        writeFileSync(
          `/tmp/vela-${name}-${width}-${mode}-geometry.json`,
          JSON.stringify(geometry, null, 2),
        )
        await page.screenshot({ path: `/tmp/vela-${name}-${width}-${mode}.png`, fullPage: true })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        )

        const stop = page.getByRole('button', {
          name: name.endsWith('interrupted') ? 'Stop session' : 'Stop',
          exact: true,
        })

        await expect(stop).toBeEnabled()

        if (width === 390)
          expect(
            (await stop.boundingBox())!.y + (await stop.boundingBox())!.height,
          ).toBeLessThanOrEqual(782)
        expect(scene.unknownRequests).toEqual([])
        expect(scene.writes).toEqual([])
      })
    }
  }
}

for (const name of [
  'alignment-setup',
  'alignment-baseline-solving',
  'alignment-baseline-no-solution',
  'alignment-unavailable',
  'alignment-stopped',
  'alignment-finished',
] satisfies AlignmentScene[]) {
  test(`alignment operational ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 782 })
    const { scene } = await openAlignmentScene(page, name)
    await expect(page.getByRole('heading', { name: 'Polar alignment', exact: true })).toBeVisible()
    await page.evaluate(() => document.fonts.ready)
    await page.screenshot({ path: `/tmp/vela-${name}-390.png`, fullPage: true })
    expect(scene.unknownRequests).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('appearance preserves alignment viewport, solve and command state', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 782 })
  const { scene } = await openAlignmentScene(page, 'alignment-phone-adjusting')
  await page.getByRole('button', { name: 'Fine · 1′', exact: true }).click()
  const image = page.locator('.vela-polar-image svg image')
  const href = await image.getAttribute('href')
  const box = await page.locator('.vela-polar-image svg').getAttribute('viewBox')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('radio', { name: 'Dark', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Fine · 1′', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(image).toHaveAttribute('href', href!)
  await expect(page.locator('.vela-polar-image svg')).toHaveAttribute('viewBox', box!)
  expect(scene.writes).toEqual([])
})

test('failed next image preserves paired solve and interrupted browser gives past-tense guidance', async ({
  page,
}) => {
  const { scene } = await openAlignmentScene(page, 'alignment-phone-adjusting')
  await expect(page.locator('.vela-polar-total strong')).toHaveText('38″')
  const prior = scene.snapshot()
  const nextUrl = '/api/rigs/fra400/alignment/images/review-solve-2'
  scene.setImageFailure(nextUrl, 503)
  scene.setView({
    ...prior,
    measuredAt: '2026-10-01T01:02:15Z',
    measurement: { ...prior.measurement!, imageUrl: nextUrl, totalArcsec: 7 },
  })
  await expect(page.getByText(/Previous readings and overlay remain together/)).toBeVisible()
  await expect(page.locator('.vela-polar-total strong')).toHaveText('38″')
  await expect(page.locator('.vela-polar-image svg image')).toHaveAttribute(
    'href',
    prior.measurement!.imageUrl,
  )
  await expect(page.locator('.vela-polar-total time')).toHaveAttribute(
    'datetime',
    prior.measuredAt!,
  )
  scene.setReadFailure(503)
  await expect(page.getByText('Measurements interrupted', { exact: true })).toBeVisible()
  await expect(page.locator('.vela-polar-directions')).toContainText('Last: right')
  await expect(page.getByRole('button', { name: 'Stop session', exact: true })).toBeDisabled()
  scene.setReadFailure(null)
  scene.setImageFailure(nextUrl, null)
  await expect(page.locator('.vela-polar-total strong')).toHaveText('7″')
  await expect(page.locator('.vela-polar-image svg image')).toHaveAttribute('href', nextUrl)
  expect(scene.writes).toEqual([])
})

for (const action of ['stop', 'finish'] as const) {
  test(`alignment ${action} does not replay while outcome remains unknown`, async ({ page }) => {
    const { scene } = await openAlignmentScene(page, 'alignment-phone-adjusting')
    scene.setCommandOutcome(action, 'unconfirmed-active')

    const button = page.getByRole('button', {
      name: action === 'stop' ? 'Stop' : 'Finish alignment',
      exact: true,
    })

    await button.click()
    await expect(page.getByText('Command outcome unknown', { exact: true })).toBeVisible()
    const readCount = scene.reads
    await expect.poll(() => scene.reads).toBeGreaterThan(readCount + 1)
    await expect(button).toBeDisabled()
    expect(scene.writes).toHaveLength(1)
    scene.setView({
      ...scene.snapshot(),
      active: false,
      phase: action === 'stop' ? 'stopped' : 'finished',
      activity: 'idle',
    })
    await expect(page.getByRole('button', { name: 'Measure again', exact: true })).toBeEnabled()
    await expect(page.getByText('Command outcome unknown', { exact: true })).toHaveCount(0)
    expect(scene.writes).toHaveLength(1)
  })
}

test('confirmed stopping state disables further end commands until cleanup completes', async ({
  page,
}) => {
  const { scene } = await openAlignmentScene(page, 'alignment-stop-pending')
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  await stop.click()
  await expect(page.locator('.vela-polar-status')).toContainText('Stopping')
  await expect(stop).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Finish alignment', exact: true })).toBeDisabled()
  expect(scene.writes).toHaveLength(1)
})

for (const mode of ['light', 'dark'] as const) {
  test(`compact appearance reference ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 782 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openAlignmentScene(page, `appearance-phone-${mode}`)
    await expect(page.locator('.vela-polar-total strong')).toHaveText('38″')
    await page.getByRole('button', { name: 'Appearance', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Appearance', exact: true })
    await expect.poll(async () => (await dialog.boundingBox())?.width).toBe(350)
    const rect = await dialog.boundingBox()
    expect(rect!.x).toBe(20)
    expect(rect!.y).toBe(48)
    await page.evaluate(() => document.fonts.ready)
    await page.mouse.move(0, 0)
    await page.screenshot({ path: `/tmp/vela-alignment-appearance-${mode}.png`, fullPage: true })
  })
}

test('short narrow alignment screen keeps Stop reachable without horizontal overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 })
  await openAlignmentScene(page, 'alignment-phone-adjusting')
  const stop = page.getByRole('button', { name: 'Stop', exact: true })
  await stop.scrollIntoViewIfNeeded()
  await expect(stop).toBeInViewport()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})


test('pending alignment Stop shows command intent while retaining the last measurement', async ({ page }) => {
  const { scene } = await openAlignmentScene(page, 'alignment-phone-adjusting')
  await expect(page.locator('.vela-polar-total strong')).toHaveText('38″')
  let release!: () => void
  const responseGate = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rigs/fra400/alignment/stop', async route => {
    const result = scene.respond('POST', '/api/rigs/fra400/alignment/stop', {})
    await responseGate
    await route.fulfill({ status: result.status, json: result.json })
  })
  await page.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(page.locator('.vela-polar-status')).toContainText('Sending command…')
  await expect(page.locator('.vela-polar-total strong')).toHaveText('38″')
  await expect(page.locator('.vela-polar-directions')).toContainText('Last: right')
  await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Finish alignment', exact: true })).toBeDisabled()
  expect(scene.writes).toHaveLength(1)
  release()
  await expect(page.getByRole('button', { name: 'Measure again', exact: true })).toBeEnabled()
  expect(scene.writes).toHaveLength(1)
})
