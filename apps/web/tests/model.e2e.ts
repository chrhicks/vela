import { expect, test, type Page } from '@playwright/test'
import type { ModelSnapshotView, RigModelView } from '@vela/model/web'

test.use({ locale: 'en-GB', timezoneId: 'UTC' })

const at = Date.parse('2026-11-02T02:00:00Z')

const fixes: ModelSnapshotView['fixes'] = Array.from({ length: 30 }, (_, i) => ({
  imageId: `fake-frame-${i + 71}`,
  at: at + i * 60_000,
  solvedJ2000: { raDegrees: 30 + i * 0.001, decDegrees: 15.001 },
  reportedJ2000: { raDegrees: 30, decDegrees: 15 },
  errorArcmin: { east: i * 0.058, north: 0.06, total: 0.06 + i * 0.058 },
  timeTrust: 'camera',
}))

const snapshot: ModelSnapshotView = {
  observedAt: at,
  position: { state: 'uncertain', since: at, reason: 'moved-without-solve' },
  lastFix: fixes.at(-1)!, fixes, fixCount: 100, rejectedCount: 2, skippedCount: 1,
}

const view: RigModelView = {
  rigId: 'fake-rig', checkedAt: at, local: { ...snapshot, position: { state: 'unknown', since: at, reason: 'never-solved' }, lastFix: null, fixes: [], fixCount: 0 },
  shadow: { state: 'available', checkpointAt: at, snapshot },
}

async function setup(page: Page) {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'unavailable' } }))
  await page.route('**/api/web/navigation', route => route.fulfill({ json: { rigs: [{ id: 'fake-rig', name: 'Fake rig' }], captures: [] } }))
}

test('separates sources, bounds frames, and shows pointing and position without rig controls', async ({ page }) => {
  await setup(page)
  const writes: string[] = []
  page.on('request', request => { if (request.method() !== 'GET') writes.push(request.method()) })
  await page.route('**/api/web/rigs/fake-rig/model', route => route.fulfill({ json: view }))
  await page.goto('/rigs/fake-rig/model')
  const shadow = page.getByRole('region', { name: 'Shadow service' })
  await expect(shadow).toContainText('uncertain')
  await expect(shadow).toContainText('moved without solve')
  await expect(shadow).toContainText('Last fix fake-frame-100')
  await expect(shadow).toContainText('Showing the last 30 of 100 fixes')
  await expect(shadow.getByRole('row')).toHaveCount(31)
  await expect(shadow.getByRole('img', { name: /Pointing error trend/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Local Aim model' })).toContainText('unknown')
  await expect(page.getByRole('button', { name: 'Controls', exact: true })).toHaveCount(0)
  expect(writes).toEqual([])

  if (process.env.MODEL_SCREENSHOT) await page.screenshot({ path: process.env.MODEL_SCREENSHOT, fullPage: true })
})

test('503 and malformed responses show a quiet unavailable line and recover on paced polling', async ({ page }) => {
  await setup(page)
  await page.clock.install()
  let response = JSON.stringify({ error: 'rig-model-unavailable' })
  let status = 503
  let requests = 0
  await page.route('**/api/web/rigs/fake-rig/model', route => {
    requests++

    return route.fulfill({ status, contentType: 'application/json', body: response })
  })
  await page.goto('/rigs/fake-rig/model')
  await expect(page.getByText(/Model unavailable/)).toBeVisible()
  const initial = requests
  await page.clock.fastForward(4900)
  expect(requests).toBe(initial)
  status = 200
  response = JSON.stringify({ ...view, shadow: { state: 'unavailable', checkpointAt: null, snapshot: null } })
  await page.clock.fastForward(200)
  await expect(page.getByRole('region', { name: 'Local Aim model' })).toContainText('unknown')
  await expect(page.getByRole('region', { name: 'Shadow service' })).toContainText('Shadow service not running / no data')
  response = JSON.stringify({ incompatible: true })
  await page.clock.fastForward(5100)
  await expect(page.getByText(/Model unavailable/)).toContainText('last known')
})

test('polling stops while hidden and resumes without accumulating snapshots', async ({ page }) => {
  await setup(page)
  await page.clock.install()
  let requests = 0
  await page.route('**/api/web/rigs/fake-rig/model', route => {
    requests++

    return route.fulfill({ json: view })
  })
  await page.goto('/rigs/fake-rig/model')
  await expect(page.getByRole('region', { name: 'Shadow service' })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  const before = requests
  await page.clock.fastForward(60_000)
  expect(requests).toBe(before)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(5100)
  await expect.poll(() => requests).toBe(before + 1)
  await expect(page.getByRole('region', { name: 'Shadow service' }).getByRole('row')).toHaveCount(31)
})
