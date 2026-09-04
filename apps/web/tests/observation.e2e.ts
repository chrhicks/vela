import { expect, test } from '@playwright/test'
import type { Route } from '@playwright/test'
import { device, observation, offlineObservation } from './fixtures/observation'

const respond = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('enters and leaves observation without a hardware command', async ({ page }) => {
  let commands = 0
  await page.route('**/api/rigs/*/connections', async (route) => { commands++; await respond(route, {}) })
  await page.route('**/api/web/rigs/rig-1', (route) => respond(route, observation().rig))
  await page.route('**/api/web/rigs/rig-1/observe', (route) => respond(route, observation()))
  await page.goto('/rigs/rig-1')
  await page.screenshot({ path: test.info().outputPath('rig-entry.png') })
  await page.getByRole('button', { name: 'Start observing' }).click()
  await expect(page).toHaveURL(/\/rigs\/rig-1\/observe$/)
  await expect(page.getByRole('heading', { name: 'Connect this Rig’s devices' })).toBeVisible()
  await page.getByRole('link', { name: 'Rig details' }).click()
  await expect(page.getByRole('heading', { name: 'Seestar S30', exact: true })).toBeVisible()
  expect(commands).toBe(0)
})

test('connects once, shows neutral progress, and focuses the confirmed result', async ({ page }) => {
  let commands = 0
  let reads = 0
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  await page.route('**/api/web/rigs/rig-1/observe', (route) => { reads++; return respond(route, observation(commands ? 'complete' : 'available')) })
  await page.route('**/api/rigs/rig-1/connections', async (route) => {
    commands++
    await pending
    await respond(route, { outcome: 'complete', command: 'completed', confirmedConnected: [device(0), device(1), device(2)], view: observation('complete') })
  })
  await page.goto('/rigs/rig-1/observe')
  await page.getByRole('button', { name: 'Connect devices' }).dblclick()
  await expect(page.getByRole('button', { name: 'Connecting devices…' })).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Device status is updating')
  await page.waitForTimeout(5_100)
  expect(reads).toBe(1)
  expect(commands).toBe(1)
  finish()
  await expect(page.getByRole('heading', { name: 'Connection preparation complete' })).toBeFocused()
  await expect(page.getByText('3 confirmed connected', { exact: true })).toBeVisible()
})

test('renders partial rejection and only retries with a new explicit command', async ({ page }) => {
  let commands = 0
  await page.route('**/api/web/rigs/rig-1/observe', (route) => respond(route, observation()))
  await page.route('**/api/rigs/rig-1/connections', (route) => {
    commands++
    return respond(route, { outcome: 'partial', confirmedConnected: [device(0)], failed: { ...device(1), reason: 'rejected' }, notAttempted: [device(2)], view: observation() })
  })
  await page.goto('/rigs/rig-1/observe')
  await page.getByRole('button', { name: 'Connect devices' }).click()
  const result = page.getByRole('region', { name: 'Last connection attempt' })
  await expect(result).toContainText('Focuser — connection rejected')
  await expect(result).toContainText('Mount')
  expect(commands).toBe(1)
  await page.getByRole('button', { name: 'Try remaining devices' }).click()
  await expect.poll(() => commands).toBe(2)
})

test('uncertainty requires a state check before offering another command', async ({ page }) => {
  let commands = 0
  await page.route('**/api/web/rigs/rig-1/observe', (route) => respond(route, observation()))
  await page.route('**/api/rigs/rig-1/connections', (route) => {
    commands++
    return respond(route, { outcome: 'uncertain', confirmedConnected: [device(0)], uncertain: { ...device(1), reason: 'verification-timeout' }, notAttempted: [device(2)], view: observation('unavailable') })
  })
  await page.goto('/rigs/rig-1/observe')
  await page.getByRole('button', { name: 'Connect devices' }).click()
  await expect(page.getByRole('heading', { name: 'The connection result is uncertain' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Connect devices', exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check Rig again' }).click()
  await expect(page.getByRole('button', { name: 'Connect devices', exact: true })).toBeVisible()
  expect(commands).toBe(1)
})

for (const failure of ['transport', 'malformed', 'conflicting-fields']) {
  test(`reconciles a ${failure} command response without replaying it`, async ({ page }) => {
    let commands = 0
    let reads = 0
    await page.route('**/api/web/rigs/rig-1/observe', (route) => { reads++; return respond(route, observation(commands ? 'complete' : 'available')) })
    await page.route('**/api/rigs/rig-1/connections', (route) => {
      commands++
      return failure === 'transport' ? route.abort() : respond(route, failure === 'malformed' ? { outcome: 'complete' } : {
        outcome: 'uncertain', confirmedConnected: [], notAttempted: [], uncertain: { ...device(0), reason: 'write-outcome-unknown' }, failed: null, view: observation(),
      })
    })
    await page.goto('/rigs/rig-1/observe')
    await page.getByRole('button', { name: 'Connect devices' }).click()
    await expect(page.getByText('3 confirmed connected', { exact: true })).toBeVisible()
    await expect(page.getByText('The command response could not be confirmed.', { exact: false })).toBeVisible()
    expect(reads).toBe(2)
    expect(commands).toBe(1)
    await expect(page.getByRole('button', { name: 'Connect devices', exact: true })).toHaveCount(0)
  })
}

test('handles already prepared, offline, missing and malformed observations', async ({ page }) => {
  let response: unknown = observation('complete')
  let status = 200
  await page.route('**/api/web/rigs/rig-1/observe', (route) => respond(route, response, status))
  await page.goto('/rigs/rig-1/observe')
  await expect(page.getByRole('heading', { name: 'Connection preparation complete' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect devices' })).toHaveCount(0)
  response = offlineObservation()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'This Rig is offline' })).toBeVisible()
  response = {}; status = 404
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Rig not found' })).toBeVisible()
  status = 200
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Could not load this Rig' })).toBeVisible()
  response = observation('available', 'wrong-rig')
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(page.getByRole('heading', { name: 'Could not load this Rig' })).toBeVisible()
})

test('retains last-known state during failed refresh and restores command eligibility on recovery', async ({ page }) => {
  let offline = false
  await page.route('**/api/web/rigs/rig-1/observe', (route) => offline ? route.abort() : respond(route, observation()))
  await page.goto('/rigs/rig-1/observe')
  await expect(page.getByRole('button', { name: 'Connect devices' })).toBeVisible()
  offline = true
  await page.getByRole('button', { name: 'Check Rig again' }).click()
  await expect(page.getByRole('heading', { name: 'Live updates are interrupted' })).toBeVisible()
  await expect(page.getByText('Last known state', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect devices' })).toHaveCount(0)
  offline = false
  await page.getByRole('button', { name: 'Check Rig again' }).click()
  await expect(page.getByRole('button', { name: 'Connect devices' })).toBeVisible()
})

test('leaving a pending command cannot overwrite another Rig', async ({ page }) => {
  let finish!: () => void
  const pending = new Promise<void>((resolve) => { finish = resolve })
  await page.route('**/api/web/rigs/*/observe', (route) => respond(route, observation('available', route.request().url().includes('rig-2') ? 'rig-2' : 'rig-1')))
  await page.route('**/api/web/rigs/rig-1', (route) => respond(route, observation().rig))
  await page.route('**/api/rigs/rig-1/connections', async (route) => {
    await pending
    await respond(route, { outcome: 'complete', command: 'not-needed', confirmedConnected: [], view: observation('complete') }).catch(() => {})
  })
  await page.goto('/rigs/rig-1/observe')
  await page.getByRole('button', { name: 'Connect devices' }).click()
  await page.getByRole('link', { name: 'Rig details' }).click()
  await page.goto('/rigs/rig-2/observe')
  finish()
  await expect(page.getByRole('heading', { name: 'Observing with Askar FRA 400' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connect devices' })).toBeVisible()
})

for (const width of [390, 768, 1280]) {
  test(`readiness fits at ${width}px with reduced motion`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.route('**/api/web/rigs/rig-1/observe', (route) => respond(route, observation('in-progress')))
    await page.goto('/rigs/rig-1/observe')
    await expect(page.getByRole('button', { name: 'Connecting devices…' })).toBeVisible()
    await expect(page.locator('.vela-observe-spinner')).toHaveCSS('animation-name', 'none')
    await expect(page.locator('.vela-observe time')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: test.info().outputPath('readiness.png'), fullPage: true })
  })
}

test('failed reads stop presenting last-known progress as active', async ({ page }) => {
  let fail = false
  await page.route('**/api/web/rigs/rig-1/observe', (route) => fail ? route.abort() : respond(route, observation('in-progress')))
  await page.goto('/rigs/rig-1/observe')
  await expect(page.getByRole('heading', { name: 'Connecting devices…' })).toBeVisible()
  fail = true
  await page.getByRole('button', { name: 'Check Rig again' }).click()
  await expect(page.getByRole('heading', { name: 'Live updates are interrupted' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Connecting devices…' })).toHaveCount(0)
  await expect(page.locator('.vela-observe-spinner')).toHaveCount(0)
  await expect(page.getByText('Status updating', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Last known state', { exact: true })).toBeVisible()
})
