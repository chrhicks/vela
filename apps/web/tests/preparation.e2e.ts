import { expect, test } from '@playwright/test'
import { openExploreScene } from './fixtures/fieldroom/browser'
import { reviewTimezone } from './fixtures/fieldroom/tonight'

test.use({ timezoneId: reviewTimezone })

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`Preparation ${mode} shows the actual temporary framing image and preserves drafts at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 989 : 782 })
      const { scene } = await openExploreScene(page, `preparation-${mode}`)
      await expect(page.getByRole('heading', { name: 'The Crescent Nebula' })).toBeVisible()
      const pixels = page.locator('.framing-exposure img')
      await expect(pixels).toBeVisible()
      await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeEnabled()
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.images).map(image => image.decode()))
        await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
      })
      await page.screenshot({ path: `/tmp/vela-preparation-${mode}-${width}.png`, fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
      await page.getByRole('spinbutton', { name: 'Exposure time' }).fill('120')
      await page.getByText('Save every exposure', { exact: true }).click()
      await pixels.evaluate(element => element.setAttribute('data-retained-frame', 'yes'))
      const source = await pixels.getAttribute('src')
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      const appearance = page.getByRole('dialog', { name: 'Appearance', exact: true })
      await appearance.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
      await page.getByRole('radio', { name: mode === 'light' ? 'Dark' : 'Light', exact: true }).check()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('spinbutton', { name: 'Exposure time' })).toHaveValue('120')
      await expect(page.getByRole('checkbox', { name: 'Save every exposure' })).not.toBeChecked()
      await expect(pixels).toHaveAttribute('src', source!)
      await expect(pixels).toHaveAttribute('data-retained-frame', 'yes')
      expect(scene.commands).toEqual([])
      expect(scene.unknownRequests).toEqual([])
    })
  }
}

test('camera choice stays a draft until a confirmed save, and accepted Start preserves the subject', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-light')
  const start = page.getByRole('button', { name: 'Start capture', exact: true })
  await expect(start).toBeEnabled()
  await page.getByRole('combobox', { name: 'Imaging camera' }).selectOption('guide-camera')
  await expect(start).toBeDisabled()
  expect(scene.commands).toEqual([])
  await page.getByRole('button', { name: 'Use this camera', exact: true }).click()
  await expect(start).toBeEnabled()
  expect(scene.commands).toHaveLength(1)
  expect(scene.commands[0]).toMatchObject({ method: 'PUT', body: { id: 'guide-camera', name: 'ASI220MM Mini' } })
  await page.getByRole('spinbutton', { name: 'Exposure time' }).fill('45')
  await start.click()
  await expect(page).toHaveURL(/\/observe\/capture$/)
  expect(scene.commands).toHaveLength(2)
  expect(scene.commands[1]).toMatchObject({ method: 'POST', pathname: '/api/rigs/fra400/capture/start',
    body: { exposureSeconds: 45, targetId: 'ngc6888', repeat: true, saveFrames: true } })
})

test('failed camera save keeps Start unavailable and never sends an exposure', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-camera-save-failed')
  await page.getByRole('combobox', { name: 'Imaging camera' }).selectOption('guide-camera')
  await page.getByRole('button', { name: 'Use this camera', exact: true }).click()
  await expect(page.getByText('The camera choice was not saved.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeDisabled()
  expect(scene.commands).toHaveLength(1)
  expect(scene.commands[0]!.method).toBe('PUT')
})

test('an uncertain start remains on preparation without command replay', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-start-uncertain')
  await page.getByRole('button', { name: 'Start capture', exact: true }).click()
  await expect(page.getByText('The command response could not be confirmed.', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/observe\?target=ngc6888$/)
  await page.getByRole('button', { name: 'Check capture state', exact: true }).click()
  expect(scene.commands).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeDisabled()
})

test('cooling commands remain explicit and independent from exposure settings', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-light')
  await page.getByRole('spinbutton', { name: 'Exposure time' }).fill('60')
  await page.getByRole('spinbutton', { name: 'Target temperature · °C' }).fill('-15')
  await page.getByRole('button', { name: 'Apply', exact: true }).click()
  expect(scene.commands).toHaveLength(1)
  expect(scene.commands[0]).toMatchObject({ pathname: '/api/rigs/fra400/capture/cooling', body: { setpointC: -15 } })
  await expect(page.getByRole('spinbutton', { name: 'Exposure time' })).toHaveValue('60')
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeEnabled()
  await page.getByRole('switch', { name: 'Cooler on' }).click()
  expect(scene.commands).toHaveLength(2)
  expect(scene.commands[1]).toMatchObject({ pathname: '/api/rigs/fra400/capture/cooling', body: { coolerOn: false } })
})

test('prepared test exposure keeps native pixels, pan and return focus through enlargement', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 989 })
  const { scene, requests } = await openExploreScene(page, 'preparation-light')
  const preview = page.getByRole('region', { name: 'Last test exposure', exact: true })
  const inline = preview.locator('.capture-image__window')
  await expect(inline.locator('img')).toBeVisible()
  await preview.getByRole('button', { name: '100%', exact: true }).click()
  await expect(inline).toHaveAttribute('data-zoomed', 'true')
  const before = await inline.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
  await inline.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => inline.evaluate(element => element.scrollLeft)).toBeGreaterThan(before.left)

  const pan = await inline.evaluate(element => ({
    x: element.scrollLeft + element.clientWidth / 2,
    y: element.scrollTop + element.clientHeight / 2,
  }))

  const source = await inline.locator('img').getAttribute('src')
  const initialHeight = (await preview.boundingBox())!.height
  await preview.getByRole('button', { name: 'Enlarge test exposure', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Inspect test exposure', exact: true })
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('img')).toHaveAttribute('src', source!)
  // Let enlargement layout and its resulting scroll events settle before closing.
  // An immediate Escape can otherwise hide a clamped-pan overwrite.
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity,
    ).map(animation => animation.finished.catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  expect((await preview.boundingBox())!.height).toBe(initialHeight)
  await page.keyboard.press('Escape')
  await expect(preview.getByRole('button', { name: 'Enlarge test exposure', exact: true })).toBeFocused()
  await expect(inline).toHaveAttribute('data-zoomed', 'true')
  expect(await inline.evaluate(element => ({
    x: element.scrollLeft + element.clientWidth / 2,
    y: element.scrollTop + element.clientHeight / 2,
  }))).toEqual(pan)
  await preview.getByRole('button', { name: 'Fit', exact: true }).click()
  await expect(inline).not.toHaveAttribute('data-zoomed', 'true')
  expect(scene.commands).toEqual([])
  expect(requests.filter(request => request.includes('/review-test-1/native.png'))).toHaveLength(1)
})

test('uncertain cooler state remains explicit and its check never replays a write', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-cooling-uncertain')
  await page.getByRole('switch', { name: 'Cooler on' }).click()
  await expect(page.getByText('Cooler command outcome unknown.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Check camera cooling', exact: true }).click()
  await expect(page.getByRole('switch', { name: 'Cooler on' })).toBeDisabled()
  expect(scene.commands).toHaveLength(1)
  expect(scene.commands[0]).toMatchObject({ pathname: '/api/rigs/fra400/capture/cooling', body: { coolerOn: false } })
})

test('preparation without a framing exposure never substitutes a capture or survey image', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-unframed')
  await expect(page.getByRole('heading', { name: 'No test exposure yet' })).toBeVisible()
  await expect(page.locator('.framing-exposure img')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeEnabled()
  expect(scene.commands).toEqual([])
})
