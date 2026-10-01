import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { CaptureImage, CaptureView } from '@vela/model/web'
import { readFileSync } from 'node:fs'
import { observation } from './fixtures/observation'
import { openExploreScene } from './fixtures/fieldroom/browser'

const pixels = readFileSync(new URL('../../../packages/ui/src/components/fixtures/capture-star-field.png', import.meta.url))

const frame: CaptureImage = {
  id: 'frame-1',
  imageUrl: '/api/rigs/rig-1/capture/images/frame-1',
  fitImageUrl: '/api/rigs/rig-1/capture/images/frame-1/fit',
  width: 1600,
  height: 1200,
  exposureSeconds: 2,
  capturedAt: '2026-09-05T18:00:00.000Z',
  receivedAt: '2026-09-05T18:00:03.000Z',
  cameraName: 'Inspection camera',
  color: 'mono',
  statistics: { detectedStars: 12, medianHfrPixels: 2.35 },
  saved: false,
  subject: null,
}

const nextFrame: CaptureImage = {
  ...frame,
  id: 'frame-2',
  imageUrl: '/api/rigs/rig-1/capture/images/frame-2',
  fitImageUrl: '/api/rigs/rig-1/capture/images/frame-2/fit',
  exposureSeconds: 3,
  statistics: { detectedStars: 24, medianHfrPixels: 1.2 },
}

const capture: CaptureView = {
  rigId: 'rig-1', rigName: 'Seestar S30', camera: { name: 'Inspection camera' },
  enabled: true, unavailableReason: null, phase: 'complete', active: false,
  captureReadState: 'current', exposureSeconds: 2, elapsedSeconds: 0, error: null,
  repeat: false, saveFrames: false, savedImageCount: 0, completedCount: 1, cooling: null,
  subject: null, savedCount: 0, integrationSeconds: 2, latestImage: frame,
}

function json<Body>(route: Route, value: Body) {
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) })
}

async function scene(page: Page) {
  let latest = frame
  let interrupted = false
  await page.route('**/api/web/navigation', route => json(route, {
    rigs: [{ id: 'rig-1', name: capture.rigName }], captures: [],
  }))
  await page.route('**/api/web/rigs/rig-1', route => json(route, observation('complete').rig))
  await page.route('**/api/web/rigs/rig-1/capture', route => interrupted
    ? route.fulfill({ status: 503 })
    : json(route, { ...capture, latestImage: latest }))
  await page.route('**/api/rigs/rig-1/capture/images/*/fit', route =>
    route.fulfill({ contentType: 'image/png', body: pixels }))

  return {
    advance: () => { latest = nextFrame },
    interrupt: () => { interrupted = true },
    recover: () => { interrupted = false },
  }
}

async function openImage(page: Page) {
  await page.goto('/rigs/rig-1/observe/capture')
  const image = page.getByRole('region', { name: 'Latest image', exact: true })
  await expect(image.getByRole('img')).toHaveAttribute('src', frame.fitImageUrl!)

  return image
}

test('native decoding holds the visible exposure across arrival, enlargement and focus return', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  const state = await scene(page)
  let requested = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**${frame.imageUrl}`, async route => {
    requested = true
    await gate
    await route.fulfill({ contentType: 'image/png', body: pixels })
  })
  const image = await openImage(page)
  await image.getByRole('button', { name: '100%' }).click()
  await expect.poll(() => requested).toBe(true)
  state.advance()
  await expect(image.getByText('A newer exposure is available.')).toBeVisible()
  await expect(image.getByRole('img')).toHaveAttribute('src', frame.fitImageUrl!)
  await expect(image.getByText('12 stars', { exact: true })).toBeVisible()
  release()
  const native = image.getByRole('region', { name: /Image at 100 percent/ })
  await expect(native).toBeVisible()
  await native.focus()
  const before = await native.evaluate(element => element.scrollLeft)
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => native.evaluate(element => element.scrollLeft)).toBe(before + 80)
  const box = await native.boundingBox()

  if (!box) throw new Error('Native image viewport is missing')
  await page.mouse.move(box.x + 120, box.y + 120)
  await page.mouse.down()
  await page.mouse.move(box.x + 80, box.y + 120)
  await page.mouse.up()
  await expect.poll(() => native.evaluate(element => element.scrollLeft)).toBe(before + 120)
  const center = await native.evaluate(element => element.scrollLeft + element.clientWidth / 2)
  await image.getByRole('button', { name: 'Enlarge image' }).click()
  const dialog = page.getByRole('dialog', { name: 'Exposure inspection' })
  await expect(dialog.getByRole('img')).toHaveAttribute('alt', '2 second exposure from Inspection camera')
  await expect(dialog.getByRole('button', { name: '100%' })).toHaveAttribute('aria-pressed', 'true')
  const enlarged = dialog.getByRole('region', { name: /Image at 100 percent/ })
  await expect.poll(async () => Math.abs(await enlarged.evaluate(element => element.scrollLeft + element.clientWidth / 2) - center)).toBeLessThanOrEqual(1)
  const nativeUrl = await dialog.getByRole('img').getAttribute('src')
  await page.emulateMedia({ colorScheme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  await expect(dialog.getByRole('img')).toHaveAttribute('src', nativeUrl!)
  await expect.poll(async () => Math.abs(await enlarged.evaluate(element => element.scrollLeft + element.clientWidth / 2) - center)).toBeLessThanOrEqual(1)
  await page.keyboard.press('Escape')
  await expect(image.getByRole('button', { name: 'Enlarge image' })).toBeFocused()
  await expect(native).toBeVisible()
  await expect.poll(async () => Math.abs(await native.evaluate(element => element.scrollLeft + element.clientWidth / 2) - center)).toBeLessThanOrEqual(1)
  await image.getByRole('button', { name: 'Show latest' }).click()
  await expect(image.getByRole('img')).toHaveAttribute('src', nextFrame.fitImageUrl!)
  await expect(image.getByText('24 stars', { exact: true })).toBeVisible()
  await expect(image.getByRole('button', { name: 'Fit', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('same-image native retry preserves fitted pixels and cache expiry disables unavailable operations', async ({ page }) => {
  const state = await scene(page)
  let reads = 0
  await page.route(`**${frame.imageUrl}`, route => {
    reads++

    return route.fulfill({ status: reads === 1 ? 503 : 404 })
  })
  const image = await openImage(page)
  await image.getByRole('button', { name: '100%' }).click()
  await expect(image.getByRole('button', { name: 'Retry full-resolution image' })).toBeVisible()
  state.advance()
  await expect(image.getByText('A newer exposure is available.')).toBeVisible()
  await image.getByRole('button', { name: 'Retry full-resolution image' }).click()
  await expect(image.getByText(/This exposure has expired/)).toBeVisible()
  expect(reads).toBe(2)
  await expect(image.getByRole('img')).toHaveAttribute('src', frame.fitImageUrl!)
  await expect(image.getByText('12 stars', { exact: true })).toBeVisible()
  await expect(image.getByRole('button', { name: 'Keep', exact: true })).toBeDisabled()
  await expect(image.getByRole('button', { name: '100%' })).toBeDisabled()
  await image.getByRole('button', { name: 'Show latest' }).click()
  await expect(image.getByRole('img')).toHaveAttribute('src', nextFrame.fitImageUrl!)
})

test('Keep completion belongs to the selected exposure after a new image arrives', async ({ page }) => {
  const state = await scene(page)
  let requested = false
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  await page.route(`**${frame.imageUrl}/keep`, async route => {
    requested = true
    await gate
    await json(route, {
      ...frame, saved: true, rigId: 'rig-1', savedAt: frame.receivedAt,
      imageUrl: '/api/rigs/rig-1/saved-images/frame-1/preview',
      fitImageUrl: '/api/rigs/rig-1/saved-images/frame-1/fit',
      fitsUrl: '/api/rigs/rig-1/saved-images/frame-1/fits',
      previewDownloadUrl: '/api/rigs/rig-1/saved-images/frame-1/download-preview',
    })
  })
  const image = await openImage(page)
  await image.getByRole('button', { name: 'Keep', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  state.advance()
  await expect(image.getByRole('img')).toHaveAttribute('src', nextFrame.fitImageUrl!)
  await expect(image.getByText(/Saving image from/)).toBeVisible()
  release()
  await expect(image.getByText(/Image from .* saved\./)).toBeVisible()
  await expect(image.getByRole('button', { name: 'Keep', exact: true })).toBeEnabled()
  await expect(image.getByText('Saved', { exact: true })).toHaveCount(0)
})

for (const width of [1440, 390]) {
  test(`enlargement covers the scrolled viewport and restores the background at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 600 })
    await scene(page)
    const image = await openImage(page)
    await page.evaluate(() => window.scrollTo(0, 60))
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0)
    const previousOverflow = await page.evaluate(() => document.body.style.overflow)
    const opener = image.getByRole('button', { name: 'Enlarge image' })
    const inlineHeight = await image.evaluate(element => element.getBoundingClientRect().height)
    const scrollBefore = await page.evaluate(() => scrollY)
    await opener.click()
    const dialog = page.getByRole('dialog', { name: 'Exposure inspection' })
    await expect(dialog).toBeVisible()
    expect(await page.locator('.capture-image[aria-label="Latest image"]').evaluate(element => element.getBoundingClientRect().height)).toBe(inlineHeight)
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore)
    const layer = page.locator('[data-image-overlay] .vela-dialog-layer')
    const rect = await layer.boundingBox()
    expect(rect).toEqual({ x: 0, y: 0, width, height: 600 })
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden')
    const background = page.locator('.vela-app > :not([data-image-overlay])')
    expect(await background.count()).toBeGreaterThan(0)
    expect(await background.evaluateAll(elements => elements.every(element => element.hasAttribute('inert')))).toBe(true)
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(opener).toBeFocused()
    expect(await background.evaluateAll(elements => elements.every(element => !element.hasAttribute('inert')))).toBe(true)
    expect(await page.evaluate(() => document.body.style.overflow)).toBe(previousOverflow)
    expect(await page.evaluate(() => scrollY)).toBe(scrollBefore)
  })
}


test('interrupted reads age the retained exposure without replacing its pixels or metadata', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-09-05T18:03:03.000Z'))
  const state = await scene(page)
  const image = await openImage(page)
  await expect(image.getByRole('heading', { name: 'Latest exposure', exact: true })).toBeVisible()
  await image.getByRole('img').evaluate(element => element.setAttribute('data-retained-pixels', 'original'))
  state.interrupt()
  await expect(image.getByRole('heading', { name: 'Last received exposure', exact: true })).toBeVisible()
  await expect(image).toHaveAttribute('data-interrupted', 'true')
  await expect(image.locator('header').getByText(/ · 3 min ago$/)).toBeVisible()
  await page.clock.setFixedTime(new Date('2026-09-05T18:04:03.000Z'))
  await expect(image.locator('header').getByText(/ · 4 min ago$/)).toBeVisible()
  await expect(image.getByRole('img')).toHaveAttribute('src', frame.fitImageUrl!)
  await expect(image.getByRole('img')).toHaveAttribute('data-retained-pixels', 'original')
  await expect(image.getByText('12 stars', { exact: true })).toBeVisible()
  state.recover()
  await expect(image.getByRole('heading', { name: 'Latest exposure', exact: true })).toBeVisible()
  await expect(image).not.toHaveAttribute('data-interrupted')
  await expect(image.getByRole('img')).toHaveAttribute('data-retained-pixels', 'original')
})

test('shared inspection keeps a complete renderer version until replacement pixels decode', async ({ page }) => {
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const nativeReads: string[] = []
  await page.route('**/pixels/**', async route => {
    const path = new URL(route.request().url()).pathname

    if (path === '/pixels/current/fit') await gate

    if (path.endsWith('/native')) nativeReads.push(path)
    await route.fulfill({ contentType: 'image/png', body: pixels })
  })
  await page.route('**/inspection-test', route => route.fulfill({ contentType: 'text/html', body:
    `<div id="root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh'
      RefreshRuntime.injectIntoGlobalHook(window)
      window.$RefreshReg$ = () => {}
      window.$RefreshSig$ = () => type => type
      window.__vite_plugin_react_preamble_installed__ = true
    </script><script type="module" src="/tests/fixtures/image-inspection.tsx"></script>`,
  }))
  await page.goto('/inspection-test')
  await expect(page.getByRole('img')).toHaveAttribute('src', '/pixels/legacy/fit')
  await page.getByRole('button', { name: 'Change version' }).click()
  await expect(page.getByRole('img')).toHaveAttribute('alt', 'Original preview')
  await page.getByRole('button', { name: 'Native', exact: true }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible()
  expect(nativeReads).toEqual(['/pixels/legacy/native'])
  release()
  await expect(page.getByRole('img')).toHaveAttribute('alt', 'Original preview')
  await page.getByRole('button', { name: 'Release hold' }).click()
  await expect(page.getByRole('img')).toHaveAttribute('src', '/pixels/current/fit')
  await expect(page.getByRole('img')).toHaveAttribute('alt', 'Current preview')
  await page.getByRole('button', { name: 'Native', exact: true }).click()
  await expect(page.getByText('ready', { exact: true })).toBeVisible()
  expect(nativeReads).toEqual(['/pixels/legacy/native', '/pixels/current/native'])
})


test('enlarged vertical wheel panning preserves the clamped horizontal inspection center', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 989 })
  const { scene } = await openExploreScene(page, 'preparation-light')
  const preview = page.getByRole('region', { name: 'Last test exposure', exact: true })
  const inline = preview.locator('.capture-image__window')
  await expect(inline.locator('img')).toBeVisible()
  await preview.getByRole('button', { name: '100%', exact: true }).click()
  await expect(inline).toHaveAttribute('data-zoomed', 'true')
  const initialLeft = await inline.evaluate(element => element.scrollLeft)
  await inline.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(() => inline.evaluate(element => element.scrollLeft)).toBe(initialLeft + 80)
  const desiredX = await inline.evaluate(element => element.scrollLeft + element.clientWidth / 2)
  await preview.getByRole('button', { name: 'Enlarge test exposure', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Inspect test exposure', exact: true })
  const enlarged = dialog.locator('.capture-image__window')
  await expect(dialog).toBeVisible()
  await dialog.evaluate(async element => {
    await Promise.all(element.getAnimations({ subtree: true }).filter(animation =>
      animation.effect?.getComputedTiming().iterations !== Infinity,
    ).map(animation => animation.finished.catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  expect(await enlarged.evaluate(element => element.scrollWidth === element.clientWidth)).toBe(true)
  const initialTop = await enlarged.evaluate(element => element.scrollTop)
  await enlarged.hover()
  await page.mouse.wheel(0, 80)
  await expect.poll(() => enlarged.evaluate(element => element.scrollTop)).toBeGreaterThan(initialTop)
  const desiredY = await enlarged.evaluate(element => element.scrollTop + element.clientHeight / 2)
  await page.keyboard.press('Escape')
  await expect(preview.getByRole('button', { name: 'Enlarge test exposure', exact: true })).toBeFocused()

  const restored = await inline.evaluate(element => ({
    x: element.scrollLeft + element.clientWidth / 2,
    y: element.scrollTop + element.clientHeight / 2,
  }))

  expect(restored.x).toBe(desiredX)
  // Odd and even viewport heights may round a half-pixel center differently.
  expect(Math.abs(restored.y - desiredY)).toBeLessThanOrEqual(0.5)
  expect(scene.commands).toEqual([])
})
