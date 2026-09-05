import { expect, test } from '@playwright/test'
import type { Route } from '@playwright/test'
import type { CaptureView } from '@vela/model/web'
import { readFileSync } from 'node:fs'

const respond = (route: Route, body: unknown) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })
const idle: CaptureView = {
  rigId: 'rig-1', rigName: 'Offline rig', camera: { name: 'Simulator Camera' }, enabled: true,
  unavailableReason: null, phase: 'idle', active: false, exposureSeconds: 2, elapsedSeconds: 0,
  error: null, latestImage: null,
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
  id: 'frame-1', imageUrl: '/api/rigs/rig-1/capture/images/frame-1', width: 1600, height: 1200,
  exposureSeconds: 2, capturedAt: '2026-09-05T18:00:00.000Z', receivedAt: '2026-09-05T18:00:03.000Z', cameraName: 'Simulator Camera', color: 'mono',
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

  current = { ...current, latestImage: { ...firstImage, id: 'frame-2', imageUrl: '/api/rigs/rig-1/capture/images/frame-2', exposureSeconds: 30 } }
  await expect.poll(() => newImageRequests).toBe(1)
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')
  await expect(image.locator('footer')).not.toContainText('30 s')
  failFirstRequest()
  await expect.poll(() => newImageRequests).toBe(2)
  await expect(image.getByRole('img')).toHaveAttribute('src', firstImage.imageUrl)
  await expect(image.locator('footer')).toContainText('2 s')

  finishRetry()
  await expect(image.getByRole('img')).toHaveAttribute('src', current.latestImage!.imageUrl)
  await expect(image.locator('footer')).toContainText('30 s')
  await expect(image.getByRole('img')).toHaveAttribute('alt', '30 second exposure from Simulator Camera')
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
  await page.route('**/api/web/rigs/rig-1/capture', route => { reads++; return respond(route, idle) })
  await page.route('**/api/rigs/rig-1/capture/start', route => { commands++; return route.abort() })
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
  await page.route('**/api/web/rigs/rig-1/capture', route => { reads++; return respond(route, current) })
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
