import { expect, test } from '@playwright/test'
import type { Route } from '@playwright/test'
import type { CaptureView } from '@vela/model/web'
import { readFileSync } from 'node:fs'

const respond = (route: Route, body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

const idle: CaptureView = {
  rigId: 'rig-1', rigName: 'Offline rig', camera: { name: 'Simulator Camera' }, enabled: true,
  unavailableReason: null, phase: 'idle', active: false, exposureSeconds: 2, elapsedSeconds: 0,
  error: null, saveFrames: false, savedImageCount: 0, latestImage: null, repeat: false, completedCount: 0,
}

test('a command stays responsive during polling and a late read cannot replace its result', async ({ page }) => {
  let commands = 0
  let reads = 0
  let holdReads = false
  let waitingRead = false
  let releaseRead!: () => void
  let releaseCommand!: () => void
  const heldRead = new Promise<void>(resolve => { releaseRead = resolve })
  const heldCommand = new Promise<void>(resolve => { releaseCommand = resolve })
  const exposing: CaptureView = { ...idle, phase: 'exposing', active: true, exposureSeconds: 2 }
  await page.route('**/api/web/rigs/rig-1/capture', async route => {
    reads++
    const responseAtRequest = commands ? exposing : idle

    if (holdReads) {
      waitingRead = true
      await heldRead
    }

    await respond(route, responseAtRequest)
  })
  await page.route('**/api/rigs/rig-1/capture/start', async route => {
    commands++
    await heldCommand
    await respond(route, exposing)
  })
  await page.goto('/rigs/rig-1/observe/capture')
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeEnabled()
  holdReads = true
  await expect.poll(() => waitingRead).toBe(true)
  await page.getByRole('button', { name: 'Take exposure' }).click()
  await expect(page.getByRole('button', { name: 'Sending command…' })).toBeDisabled()
  expect(commands).toBe(1)
  releaseCommand()
  await expect(page.getByRole('button', { name: 'Stop exposure' })).toBeEnabled()
  const readsBeforeRelease = reads
  releaseRead()
  await expect.poll(() => reads).toBeGreaterThan(readsBeforeRelease)
  await expect(page.getByRole('button', { name: 'Stop exposure' })).toBeEnabled()
  expect(commands).toBe(1)
})

const preview = readFileSync(new URL('../../../packages/ui/src/components/fixtures/capture-star-field.png', import.meta.url))

const firstImage = {
  id: 'frame-1', saved: false, imageUrl: '/api/rigs/rig-1/capture/images/frame-1', width: 1600, height: 1200,
  exposureSeconds: 2, capturedAt: '2026-09-05T18:00:00.000Z', receivedAt: '2026-09-05T18:00:03.000Z', cameraName: 'Simulator Camera', color: 'mono', statistics: { detectedStars: 12, medianHfrPixels: 2.35 },
}

test('loads a fitted preview first and only presents 100 percent after its native image loads', async ({ page }) => {
  const fitImageUrl = `${firstImage.imageUrl}/fit`
  let nativeRequests = 0
  let releaseNative!: () => void
  const nativeGate = new Promise<void>(resolve => { releaseNative = resolve })
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, { ...idle, phase: 'complete', latestImage: { ...firstImage, fitImageUrl } }))
  await page.route(`**${fitImageUrl}`, route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.route(`**${firstImage.imageUrl}`, async route => {
    nativeRequests++
    await nativeGate
    await route.fulfill({ contentType: 'image/png', body: preview })
  })
  await page.goto('/rigs/rig-1/observe/capture')
  const image = page.getByRole('region', { name: 'Latest image', exact: true })
  await expect(image.getByRole('img')).toHaveAttribute('src', fitImageUrl)
  expect(nativeRequests).toBe(0)
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await expect.poll(() => nativeRequests).toBe(1)
  await expect(image).toContainText('Loading full-resolution image')
  await expect(image.getByRole('img')).toHaveAttribute('src', fitImageUrl)
  await expect(page.getByRole('region', { name: 'Image at 100 percent. Scroll to inspect.' })).toHaveCount(0)
  releaseNative()
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(page.getByRole('region', { name: 'Image at 100 percent. Scroll to inspect.' })).toBeVisible()
  await expect(image.locator('footer')).toContainText('2 s')
})

test('keeps the loaded image and its metadata together through a failed new-image request and retry', async ({ page }) => {
  let current: CaptureView = { ...idle, phase: 'complete', latestImage: firstImage }
  let newImageRequests = 0
  let failFirstRequest!: () => void
  let finishRetry!: () => void
  const heldFailure = new Promise<void>(resolve => { failFirstRequest = resolve })
  const heldRetry = new Promise<void>(resolve => { finishRetry = resolve })
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/frame-1', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.route('**/api/rigs/rig-1/capture/images/frame-2', async route => {
    newImageRequests++

    if (newImageRequests === 1) {
      await heldFailure
      await route.abort()
    } else {
      await heldRetry
      await route.fulfill({ contentType: 'image/png', body: preview })
    }
  })
  await page.goto('/rigs/rig-1/observe/capture')
  const image = page.getByRole('region', { name: 'Latest image', exact: true })
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')

  current = { ...current, latestImage: { ...firstImage, id: 'frame-2', imageUrl: '/api/rigs/rig-1/capture/images/frame-2', exposureSeconds: 30, statistics: { detectedStars: 7, medianHfrPixels: 3.6 } } }
  await expect.poll(() => newImageRequests).toBe(1)
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')
  await expect(image.locator('footer')).not.toContainText('30 s')
  await expect(image.locator('.capture-image__statistics')).toContainText('12')
  await expect(image.locator('.capture-image__statistics')).toContainText('2.35')
  failFirstRequest()
  await expect.poll(() => newImageRequests).toBe(2)
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')

  finishRetry()
  await expect(image.getByRole('img')).toHaveAttribute('src', current.latestImage!.imageUrl)
  await expect(image.locator('footer')).toContainText('30 s')
  await expect(image.getByRole('img')).toHaveAttribute('alt', '30 second exposure from Simulator Camera')
  await expect(image.locator('.capture-image__statistics')).toContainText('7')
  await expect(image.locator('.capture-image__statistics')).toContainText('3.60')
  await expect(image.locator('.capture-image__statistics')).not.toContainText('2.35')
})

test('retains the image during interrupted updates and shows the server exposure after reopening', async ({ page }) => {
  let offline = false
  let current: CaptureView = { ...idle, phase: 'exposing', active: true, exposureSeconds: 30, elapsedSeconds: 8, latestImage: firstImage }
  await page.route('**/api/web/rigs/rig-1/capture', route => offline ? route.abort() : respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/frame-1', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.goto('/rigs/rig-1/observe/capture')
  await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toHaveValue('30')
  await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toBeDisabled()
  const image = page.getByRole('region', { name: 'Latest image', exact: true })
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')
  current = { ...current, phase: 'complete', active: false }
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeEnabled()
  offline = true
  await expect(page.getByText('Capture status is unknown.', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeDisabled()
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')
  await expect(image).toContainText('Previous exposure')
})

test('an ambiguous command is never replayed and requires an explicit state check', async ({ page }) => {
  let commands = 0
  let reads = 0
  await page.route('**/api/web/rigs/rig-1/capture', route => { reads++;

 return respond(route, idle) })
  await page.route('**/api/rigs/rig-1/capture/start', route => { commands++;

 return route.abort() })
  await page.goto('/rigs/rig-1/observe/capture')
  await page.getByRole('button', { name: 'Take exposure' }).click()
  await expect(page.getByText('Command outcome unknown')).toBeVisible()
  const readsAfterCommand = reads
  await expect.poll(() => reads).toBeGreaterThan(readsAfterCommand)
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeDisabled()
  expect(commands).toBe(1)
  await page.getByRole('button', { name: 'Check capture state' }).click()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeEnabled()
  await expect(page.getByText('Command outcome unknown')).toHaveCount(0)
  expect(commands).toBe(1)
})

test('an active exposure disappearing after restart stays unconfirmed until an explicit check', async ({ page }) => {
  let current: CaptureView = { ...idle, phase: 'exposing', active: true, exposureSeconds: 30, elapsedSeconds: 8 }
  let reads = 0
  await page.route('**/api/web/rigs/rig-1/capture', route => { reads++;

 return respond(route, current) })
  await page.goto('/rigs/rig-1/observe/capture')
  await expect(page.getByRole('button', { name: 'Stop exposure' })).toBeEnabled()
  current = idle
  const warning = page.getByText('Vela no longer tracks the exposure that was active.', { exact: false })
  await expect(warning).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeDisabled()
  const readsAfterInterruption = reads
  await expect.poll(() => reads).toBeGreaterThan(readsAfterInterruption)
  await expect(warning).toBeVisible()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeDisabled()
  await page.getByRole('button', { name: 'Check capture state' }).click()
  await expect(warning).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeEnabled()
})

test('repeating capture restores server settings and can stop during image receipt', async ({ page }) => {
  let current: CaptureView = { ...idle, repeat: true }
  let startBody: unknown
  let stops = 0
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/frame-1', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.route('**/api/rigs/rig-1/capture/start', route => {
    startBody = route.request().postDataJSON()
    current = { ...current, phase: 'exposing', active: true }

    return respond(route, current)
  })
  await page.route('**/api/rigs/rig-1/capture/stop', route => {
    stops++
    current = { ...current, phase: 'stopped', active: false }

    return respond(route, current)
  })
  await page.goto('/rigs/rig-1/observe/capture')
  await expect(page.getByRole('checkbox', { name: 'Repeat until stopped' })).toBeChecked()
  await page.getByRole('button', { name: 'Start run' }).click()
  expect(startBody).toEqual({ exposureSeconds: 2, repeat: true, saveFrames: false })
  await expect(page.getByRole('button', { name: 'Stop run' })).toBeEnabled()
  current = { ...current, completedCount: 2, latestImage: firstImage, phase: 'reading' }
  await page.reload()
  await expect(page.getByRole('checkbox', { name: 'Repeat until stopped' })).toBeChecked()
  await expect(page.getByRole('checkbox', { name: 'Repeat until stopped' })).toBeDisabled()
  await expect(page.locator('.capture-page__count')).toHaveText('2images completed')
  await expect(page.getByRole('region', { name: 'Latest image', exact: true }).getByRole('img')).toBeVisible()
  await page.getByRole('button', { name: 'Stop run' }).click()
  await expect(page.getByRole('button', { name: 'Start run' })).toBeEnabled()
  await expect(page.locator('.capture-page__count')).toHaveText('2images completed')
  await expect(page.getByRole('region', { name: 'Latest image', exact: true }).getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  expect(stops).toBe(1)
  await page.getByText('Repeat until stopped', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toBeEnabled()
})

test('displays completed downloads during faster frame arrivals and coalesces pending images without mislabeling Fit', async ({ page }) => {
  const frame = (number: number) => ({ ...firstImage, id: `stream-${number}`,
    imageUrl: `/api/rigs/rig-1/capture/images/stream-${number}`,
    fitImageUrl: `/api/rigs/rig-1/capture/images/stream-${number}/fit`, exposureSeconds: number,
  })

  let current = { ...idle, active: true, repeat: true, phase: 'exposing', completedCount: 1, latestImage: frame(1) }
  const pending = new Map<string, Route>()
  const requested: string[] = []
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/**', route => {
    const path = new URL(route.request().url()).pathname
    requested.push(path)
    pending.set(path, route)
  })

  const finish = async (url: string) => {
    await expect.poll(() => pending.has(url)).toBe(true)
    await pending.get(url)!.fulfill({ contentType: 'image/png', body: preview })
    pending.delete(url)
  }

  const arrive = async (number: number) => {
    current = { ...current, completedCount: number, latestImage: frame(number) }
    await expect(page.locator('.capture-page__count')).toHaveText(`${number}images completed`)
  }

  await page.goto('/rigs/rig-1/observe/capture')
  const image = page.getByRole('region', { name: 'Latest image', exact: true })
  await expect.poll(() => requested).toContain(frame(1).fitImageUrl)
  await arrive(2)
  await arrive(3)
  await finish(frame(1).fitImageUrl)
  await expect(image.getByRole('img')).toHaveAttribute('src', frame(1).fitImageUrl)
  await expect(image.getByRole('img')).toHaveAttribute('alt', '1 second exposure from Simulator Camera')
  await expect.poll(() => requested).toContain(frame(3).fitImageUrl)
  expect(requested).not.toContain(frame(2).fitImageUrl)

  await arrive(4)
  await arrive(5)
  await finish(frame(3).fitImageUrl)
  await expect(image.getByRole('img')).toHaveAttribute('src', frame(3).fitImageUrl)
  await expect(image.locator('footer')).toContainText('3 s')
  await expect.poll(() => requested).toContain(frame(5).fitImageUrl)
  expect(requested).not.toContain(frame(4).fitImageUrl)
  await page.getByRole('button', { name: '100%', exact: true }).click()
  await finish(frame(5).fitImageUrl)
  await expect(image.getByRole('img')).toHaveAttribute('src', frame(5).fitImageUrl)
  await expect(image.locator('footer')).toContainText('5 s')
  await expect(page.getByRole('button', { name: '100%', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('region', { name: 'Image at 100 percent. Scroll to inspect.' })).toHaveCount(0)
  await finish(frame(5).imageUrl)
  await expect(image.getByRole('img')).toHaveAttribute('src', frame(5).imageUrl)
  await expect(page.getByRole('button', { name: '100%', exact: true })).toHaveAttribute('aria-pressed', 'true')
})


test('distinguishes unavailable star measurements from an image with no measurable stars', async ({ page }) => {
  let current = { ...idle, phase: 'complete', latestImage: { ...firstImage, statistics: null as { detectedStars: number, medianHfrPixels: number | null } | null } }
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/*', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.goto('/rigs/rig-1/observe/capture')
  const statistics = page.locator('.capture-image__statistics')
  await expect(statistics).toContainText('1600 × 1200')
  await expect(statistics).toContainText('Star measurements unavailable')
  await expect(statistics.locator('dd')).toHaveText(['1600 × 1200', '—', '—'])
  current = { ...current, latestImage: { ...firstImage, id: 'starless', imageUrl: '/api/rigs/rig-1/capture/images/starless', statistics: { detectedStars: 0, medianHfrPixels: null } } }
  await expect(statistics).toContainText('No measurable stars')
  await expect(statistics.locator('dd')).toHaveText(['1600 × 1200', '0', '—'])
})


test('keeping the displayed frame remains independent of Stop when a newer preview is delayed', async ({ page }) => {
  let current = { ...idle, active: true, phase: 'exposing', latestImage: firstImage }
  let keptId = ''
  let stopped = false
  let releaseKeep!: () => void
  const gate = new Promise<void>(resolve => { releaseKeep = resolve })
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/frame-1', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.route('**/api/rigs/rig-1/capture/images/frame-2', route => route.abort())
  await page.route('**/api/rigs/rig-1/capture/images/*/keep', async route => {
    keptId = route.request().url().split('/').at(-2)!
    await gate
    await route.fulfill({ status: 410, body: '{}' })
  })
  await page.route('**/api/rigs/rig-1/capture/stop', route => {
    stopped = true

    return respond(route, { ...current, active: false, phase: 'stopped' })
  })
  await page.goto('/rigs/rig-1/observe/capture')
  await expect(page.getByRole('button', { name: 'Keep this image' })).toBeVisible()
  current = { ...current, latestImage: { ...firstImage, id: 'frame-2', imageUrl: '/api/rigs/rig-1/capture/images/frame-2' } }
  await page.waitForTimeout(1300)
  await page.getByRole('button', { name: 'Keep this image' }).click()
  await expect.poll(() => keptId).toBe('frame-1')
  await page.getByRole('button', { name: 'Stop exposure' }).click()
  await expect.poll(() => stopped).toBe(true)
  releaseKeep()
  await expect(page.getByText('This exposure is no longer available to save.', { exact: false })).toBeVisible()
})

test('saved collection opens a retained image and original downloads without camera state', async ({ page }) => {
  const saved = { ...firstImage, saved: true, rigId: 'rig-1', savedAt: firstImage.receivedAt,
    imageUrl: '/api/rigs/rig-1/saved-images/frame-1/preview', fitsUrl: '/api/rigs/rig-1/saved-images/frame-1/fits',
    previewDownloadUrl: '/api/rigs/rig-1/saved-images/frame-1/download-preview' }

  let deviceReads = 0
  await page.route('**/api/web/rigs/rig-1/capture', route => { deviceReads++;

 return route.abort() })
  await page.route('**/api/web/rigs/rig-1/saved-images', route => respond(route, { rigId: 'rig-1', rigName: 'Offline rig', images: [saved] }))
  await page.route('**/api/web/rigs/rig-1/saved-images/frame-1', route => respond(route, { rigId: 'rig-1', rigName: 'Offline rig', image: saved }))
  await page.route('**/api/rigs/rig-1/saved-images/frame-1/preview', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.goto('/rigs/rig-1/observe/saved-images')
  await expect(page.getByRole('heading', { name: 'Saved images', exact: true })).toBeVisible()
  await page.locator('.vela-saved-card').click()
  await expect(page.getByRole('region', { name: 'Saved preview' }).getByRole('img')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Download FITS' })).toHaveAttribute('href', saved.fitsUrl)
  await expect(page.getByRole('link', { name: 'Download preview' })).toHaveAttribute('href', saved.previewDownloadUrl)
  expect(deviceReads).toBe(0)
})

test('keeps a manual save outcome and retry attached to its image after newer pixels load', async ({ page }) => {
  let current = { ...idle, active: true, phase: 'exposing', latestImage: firstImage }
  const requestedIds: string[] = []
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })

  const saved = { ...firstImage, saved: true, rigId: 'rig-1', savedAt: firstImage.receivedAt,
    imageUrl: '/api/rigs/rig-1/saved-images/frame-1/preview', fitsUrl: '/api/rigs/rig-1/saved-images/frame-1/fits',
    previewDownloadUrl: '/api/rigs/rig-1/saved-images/frame-1/download-preview' }

  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/capture/images/*', route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.route('**/api/rigs/rig-1/capture/images/*/keep', async route => {
    requestedIds.push(route.request().url().split('/').at(-2)!)

    if (requestedIds.length === 1) {
      await pending
      await respond(route, {}, 503)
    } else await respond(route, saved)
  })
  await page.goto('/rigs/rig-1/observe/capture')
  await page.getByRole('button', { name: 'Keep this image' }).click()
  await expect.poll(() => requestedIds.length).toBe(1)
  current = { ...current, latestImage: { ...firstImage, id: 'frame-2', imageUrl: '/api/rigs/rig-1/capture/images/frame-2' } }
  await expect(page.getByRole('region', { name: 'Latest image' }).getByRole('img')).toHaveAttribute('src', current.latestImage.imageUrl)
  await expect(page.getByText('Saving image from', { exact: false })).toBeVisible()
  finish()
  await expect(page.getByText('Saving could not be confirmed.', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: 'Retry saving image' }).click()
  await expect.poll(() => requestedIds).toEqual(['frame-1', 'frame-1'])
  await expect(page.getByText(/Image from .+ saved\./)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Keep this image' })).toBeEnabled()
})

test('labels estimated starts on the loaded capture and saved image detail', async ({ page }) => {
  let estimated = true
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, { ...idle, phase: 'complete', latestImage: { ...firstImage, ...(estimated ? { capturedAtSource: 'server-estimate' } : {}) } }))
  await page.route(`**${firstImage.imageUrl}`, route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.goto('/rigs/rig-1/observe/capture')
  await expect(page.getByText('Start time estimated', { exact: true })).toBeVisible()
  estimated = false
  await page.reload()
  await expect(page.getByAltText('2 second exposure from Simulator Camera')).toBeVisible()
  await expect(page.getByText('Start time estimated', { exact: true })).toHaveCount(0)

  const image = { ...firstImage, capturedAtSource: 'server-estimate', saved: true, rigId: 'rig-1', savedAt: '2026-09-05T18:00:04.000Z',
    imageUrl: '/api/rigs/rig-1/saved-images/frame-1/preview', fitsUrl: '/api/rigs/rig-1/saved-images/frame-1/fits', previewDownloadUrl: '/api/rigs/rig-1/saved-images/frame-1/download-preview' }

  await page.route('**/api/web/rigs/rig-1/saved-images/frame-1', route => respond(route, { rigId: 'rig-1', rigName: 'Offline rig', image }))
  await page.route(`**${image.imageUrl}`, route => route.fulfill({ contentType: 'image/png', body: preview }))
  await page.goto('/rigs/rig-1/observe/saved-images/frame-1')
  await expect(page.getByRole('region', { name: 'Saved preview' }).getByText('Start time estimated', { exact: true })).toBeVisible()
})
