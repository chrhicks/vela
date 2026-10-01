import { expect, test } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openAutofocusScene } from './fixtures/fieldroom/browser'
import { autofocusScenes } from './fixtures/fieldroom/autofocus'

for (const width of [1440, 768, 390]) {
  for (const mode of ['light', 'dark'] as const) {
    for (const name of ['autofocus-ready', 'autofocus-running', 'autofocus-interrupted', 'autofocus-result', 'autofocus-restored', 'autofocus-invalid-window', 'autofocus-restore-unconfirmed', 'autofocus-offline'] as const) {
      test(`autofocus reference ${name} ${width} ${mode}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 782 : 900 })
        const { scene } = await openAutofocusScene(page, name)

        if (mode === 'dark') {
          await page.getByRole('button', { name: 'Appearance', exact: true }).click()
          await page.getByRole('radio', { name: 'Dark', exact: true }).check()
          await page.keyboard.press('Escape')
        }

        await expect(page.getByRole('heading', { name: 'Autofocus', exact: true })).toBeVisible()

        if (name === 'autofocus-offline') await expect(page.getByText('Autofocus state is unknown')).toBeVisible()
        await page.evaluate(() => document.fonts.ready)

        if (name === 'autofocus-ready' && width === 1440)
          await expect(page.locator('.vela-af-ready')).toHaveCSS('height', '96px')

        if (width === 390 && ['autofocus-ready', 'autofocus-invalid-window'].includes(name)) {
          await expect(page.locator('.vela-af-window--compact')).toBeVisible()
          await expect(page.locator('.vela-af-window--desktop')).toBeHidden()
          const label = page.locator('.vela-af-window--compact text').first()
          expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(13)
        }

        await page.getByRole('heading', { name: 'Autofocus', exact: true }).click()
        await page.mouse.move(0, 0)

        const geometry = await page.evaluate(
          selectors => ({
            viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
            mode: document.documentElement.dataset.mode,
            elements: selectors.flatMap(selector =>
              Array.from(document.querySelectorAll(selector)).map(element => {
                const rect = element.getBoundingClientRect()
                const style = getComputedStyle(element)

                return {
                  selector,
                  x: rect.x,
                  y: rect.y,
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
            '.vela-af-chart-panel',
            '.vela-af-ready',
            '.vela-af-status',
            '.vela-af-outcome',
            '.vela-af-chart',
            '.vela-af-facts',
            '.vela-af-step',
            '.vela-af-actions',
          ],
        )

        writeFileSync(
          `/tmp/vela-${name}-${width}-${mode}-geometry.json`,
          JSON.stringify(geometry, null, 2),
        )
        await page.screenshot({ path: `/tmp/vela-${name}-${width}-${mode}.png`, fullPage: true, animations: 'disabled' })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)

        if (name === 'autofocus-running') {
          const stop = page.getByRole('button', { name: 'Stop and restore start', exact: true })
          await expect(stop).toBeEnabled()

          if (width === 390) expect((await stop.boundingBox())!.y + (await stop.boundingBox())!.height).toBeLessThanOrEqual(782)
        }

        if (!['autofocus-ready', 'autofocus-running'].includes(name)) {
          await expect(page.locator('.vela-af-outcome .vela-button')).toHaveAttribute('data-tone', 'neutral')
        }

        expect(scene.unknownRequests).toEqual([])
        expect(scene.writes).toEqual([])
      })
    }
  }
}

for (const name of autofocusScenes.filter(name => ['autofocus-moving', 'autofocus-measuring', 'autofocus-fitting', 'autofocus-confirming', 'autofocus-no-stars', 'autofocus-restoring'].includes(name))) {
  test(`autofocus operational ${name}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 782 })
    const { scene } = await openAutofocusScene(page, name)
    await expect(page.getByRole('heading', { name: 'Autofocus', exact: true })).toBeVisible()
    await expect(page.locator('.vela-af-point')).toHaveCount(scene.snapshot().samples.length)

    if (name === 'autofocus-no-stars') {
      await expect(page.locator('.vela-af-point[data-empty]')).toHaveCount(1)
      await expect(page.getByText('Hollow markers show positions with no measurable stars, not an HFR value.')).toBeVisible()
    }

    await page.screenshot({ path: `/tmp/vela-${name}-390.png`, fullPage: true, animations: 'disabled' })
    expect(scene.unknownRequests).toEqual([])
    expect(scene.writes).toEqual([])
  })
}

test('appearance keeps autofocus samples, settings and command state', async ({ page }) => {
  const { scene } = await openAutofocusScene(page, 'autofocus-running')
  await expect(page.locator('.vela-af-point')).toHaveCount(5)
  await page.evaluate(() => document.fonts.ready)
  const positions = await page.locator('.vela-af-point').evaluateAll(points => points.map(point => point.getAttribute('cx')))
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('radio', { name: 'Dark', exact: true }).check()
  await page.keyboard.press('Escape')
  expect(await page.locator('.vela-af-point').evaluateAll(points => points.map(point => point.getAttribute('cx')))).toEqual(positions)
  await expect(page.getByRole('button', { name: 'Stop and restore start', exact: true })).toBeEnabled()
  expect(scene.writes).toEqual([])
})

test('confirmed stopping and restoration keep Stop disabled without another command', async ({ page }) => {
  const { scene } = await openAutofocusScene(page, 'autofocus-stop-pending')
  const stop = page.getByRole('button', { name: 'Stop and restore start', exact: true })
  await stop.click()
  await expect(page.getByText('Stopping…', { exact: true }).first()).toBeVisible()
  await expect(stop).toBeDisabled()
  expect(scene.writes).toHaveLength(1)
  scene.setView({ ...scene.snapshot(), activity: 'restoring' })
  await expect(page.getByText('Restoring start…', { exact: true })).toBeVisible()
  await expect(stop).toBeDisabled()
  expect(scene.writes).toHaveLength(1)
})
