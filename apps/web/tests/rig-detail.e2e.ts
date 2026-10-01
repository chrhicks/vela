import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { HomeView, RigDetailView } from '@vela/model/web'

const now = new Date().toISOString()

const endpoint = { host: '192.168.4.104', port: 11111 }

function homeWithRig(): HomeView {
  return {
    rigs: [
      {
        id: 'rig-1',
        name: 'Backyard rig',
        reachability: 'reachable',
        lastSeenAt: now,
        connections: { total: 7, connected: 7, disconnected: 0, unavailable: 0 },
        capabilities: ['forget'],
      },
    ],
    refreshedAt: now,
  }
}

function liveDetail(sensorTemperatureC = -5): RigDetailView {
  return {
    id: 'rig-1',
    name: 'Backyard rig',
    state: 'reachable',
    endpoint,
    addedAt: now,
    lastInventoryAt: now,
    refreshedAt: now,
    connections: { total: 7, connected: 7, disconnected: 0, unavailable: 0 },
    devices: [
      {
        id: 'switch-0',
        kind: 'switch',
        name: 'Power box',
        configuredName: 'Switch slot',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'complete',
          activity: 'reporting',
          channels: [{ id: 0, name: 'Input Voltage', value: 12.9, on: true }],
        },
      },
      {
        id: 'camera-0',
        kind: 'camera',
        name: 'Main camera',
        configuredName: 'Camera slot 1',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'complete',
          activity: 'idle',
          sensorTemperatureC,
          cooling: { state: 'on', powerPercent: 42 },
        },
      },
      {
        id: 'telescope-0',
        kind: 'telescope',
        name: 'Mount',
        configuredName: 'Mount',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'complete',
          activity: 'tracking',
          tracking: 'on',
          parking: 'unparked',
          home: 'away',
        },
      },
      {
        id: 'camera-1',
        kind: 'camera',
        name: 'Guide camera',
        configuredName: 'Camera slot 2',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'complete',
          activity: 'idle',
          sensorTemperatureC: 12,
        },
      },
      {
        id: 'conditions-0',
        kind: 'observing-conditions',
        name: 'Weather sensor',
        configuredName: 'Conditions slot',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'partial',
          activity: 'reporting',
          temperatureC: 18,
          humidityPercent: 55,
        },
      },
      {
        id: 'focuser-0',
        kind: 'focuser',
        name: 'Focuser',
        configuredName: 'Focuser',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'complete',
          activity: 'idle',
          position: 32888,
          temperatureC: 17,
        },
      },
      {
        id: 'filter-0',
        kind: 'filter-wheel',
        name: 'Filter wheel',
        configuredName: 'Filter wheel',
        connection: 'connected',
        observedAt: now,
        status: {
          availability: 'complete',
          activity: 'idle',
          position: 1,
          filterName: 'Dark',
        },
      },
    ],
    capabilities: ['forget'],
  }
}

function offlineDetail(): RigDetailView {
  return {
    id: 'offline',
    name: 'Offline rig',
    state: 'offline',
    endpoint,
    addedAt: now,
    lastInventoryAt: now,
    refreshedAt: now,
    connections: { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
    devices: [
      {
        id: 'offline-camera-0',
        kind: 'camera',
        name: 'Camera slot',
        configuredName: 'Camera slot',
        connection: 'unavailable',
        status: { availability: 'unavailable' },
      },
    ],
    capabilities: ['forget'],
  }
}

async function fulfillJson<Body>(route: Route, body: Body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function useHome(page: Page, getHome: () => HomeView) {
  await page.route('**/api/web/home', route => fulfillJson(route, getHome()))
}

test('navigates through the complete Rig card and renders ordered responsive detail', async ({
  page,
}) => {
  await useHome(page, homeWithRig)
  await page.route('**/api/web/rigs/rig-1', route => fulfillJson(route, liveDetail()))

  await page.goto('/')
  const rigLink = page.getByRole('link', { name: 'View Backyard rig' })
  await expect(rigLink).toBeVisible()
  await expect(rigLink.getByText('7 of 7')).toBeVisible()
  await rigLink.click()

  await expect(page).toHaveURL(/\/rigs\/rig-1$/)
  await expect(
    page.locator('.vela-navigation').getByRole('link', { name: 'Tonight', exact: true }),
  ).toHaveAttribute('href', '/rigs/rig-1/observe/capture')
  await expect(page.getByRole('heading', { level: 1, name: 'Your rig' })).toBeVisible()
  await expect(page.locator('.equipment__name h3')).toHaveText([
    'Mount',
    'Focuser',
    'Main camera',
    'Guide camera',
    'Filter wheel',
    'Weather sensor',
    'Power box',
  ])

  for (const name of ['Main camera', 'Weather sensor', 'Power box'])
    await page.getByRole('button', { name: `Show ${name} details` }).click()

  await expect(page.getByText('Some values could not be read')).toBeVisible()
  await expect(page.getByText('Input Voltage')).toBeVisible()
  await expect(page.getByText('12.9 · On', { exact: true })).toBeVisible()
  await expect(page.getByText('12.9 V', { exact: true })).toHaveCount(0)

  const details = page.locator('.equipment__rig-details')
  await expect(details).not.toHaveAttribute('open')
  await details.locator('summary').click()
  await expect(details).toHaveAttribute('open', '')
  await expect(page.getByText('192.168.4.104:11111', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await expect(page.getByRole('button', { name: 'Hide Main camera details' })).toBeVisible()
  await expect.poll(() => page.locator('.equipment__device-details dl').first()
    .evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)

})

test('shows active refresh, retains stale values, and resumes non-overlapping polling', async ({
  page,
}) => {
  let requests = 0
  await page.route('**/api/web/rigs/rig-1', async route => {
    requests += 1

    if (requests === 2) {
      await new Promise(resolve => setTimeout(resolve, 5_500))
      await fulfillJson(route, { error: 'temporary' }, 503)

      return
    }

    await fulfillJson(route, liveDetail(requests >= 3 ? -4 : -5))
  })

  await page.goto('/rigs/rig-1')
  await page.getByRole('button', { name: 'Show Main camera details' }).click()
  await expect(page.getByText('-5.0 °C', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Refresh state' }).click()
  const refreshing = page.getByRole('button', { name: 'Refreshing state…' })
  await expect(refreshing).toBeDisabled()
  await expect(refreshing).toHaveAttribute('aria-busy', 'true')
  await page.waitForTimeout(5_100)
  expect(requests).toBe(2)
  await expect(refreshing).toBeDisabled()
  await expect(page.getByRole('status').first()).toContainText('Live updates are interrupted')
  await expect(page.getByText('-5.0 °C', { exact: true })).toBeVisible()
  await expect(page.getByText('Last known').first()).toBeVisible()
  expect(requests).toBe(2)

  await page.getByRole('button', { name: 'Refresh state' }).click()
  await expect(page.getByText('-4.0 °C', { exact: true })).toBeVisible()
  await expect(page.getByText('Live updates are interrupted')).toHaveCount(0)
  expect(requests).toBe(3)

  await expect.poll(() => requests, { timeout: 6_500 }).toBeGreaterThanOrEqual(4)
})

test('pauses polling while hidden and refreshes immediately when visible', async ({ page }) => {
  let requests = 0
  await page.route('**/api/web/rigs/rig-1', async route => {
    requests += 1
    await fulfillJson(route, liveDetail())
  })

  await page.goto('/rigs/rig-1')
  await expect(page.getByRole('heading', { level: 1, name: 'Your rig' })).toBeVisible()
  expect(requests).toBe(1)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.waitForTimeout(5_200)
  expect(requests).toBe(1)

  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => requests).toBe(2)
})

test('distinguishes offline, unknown, and malformed fresh loads', async ({ page }) => {
  await page.route('**/api/web/rigs/*', async route => {
    const path = new URL(route.request().url()).pathname

    if (path.endsWith('/offline')) {
      await fulfillJson(route, offlineDetail())
    } else if (path.endsWith('/missing')) {
      await fulfillJson(route, { error: 'rig-not-found' }, 404)
    } else {
      await fulfillJson(route, { id: 'malformed' })
    }
  })

  await page.goto('/rigs/offline')
  await expect(page.getByRole('status').first()).toContainText('This Rig is offline')
  await page.getByRole('button', { name: 'Show Camera slot details' }).click()
  await expect(page.getByText('No live information from this device')).toBeVisible()
  await expect(page.locator('.equipment__connection').filter({ hasText: 'Unavailable' })).toBeVisible()

  await page.goto('/rigs/missing')
  await expect(page.getByRole('heading', { name: 'Rig not found' })).toBeVisible()

  await page.goto('/rigs/malformed')
  await expect(page.getByRole('heading', { name: 'Could not load this Rig' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('forgets from the secondary management area and returns Home', async ({ page }) => {
  let forgotten = false
  let deleteRequests = 0
  await useHome(page, () => (forgotten ? { rigs: [], refreshedAt: now } : homeWithRig()))
  await page.route('**/api/web/rigs/rig-1', route => fulfillJson(route, liveDetail()))
  await page.route('**/api/rigs/rig-1', async route => {
    deleteRequests += 1
    forgotten = true
    await route.fulfill({ status: 204, body: '' })
  })

  await page.goto('/rigs/rig-1')
  await page.locator('.equipment__rig-details summary').click()
  await page.getByRole('button', { name: 'Forget rig' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Forget Backyard rig?' })
  await expect(confirmation).toContainText('does not change its ALPACA server or hardware')
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  expect(deleteRequests).toBe(0)

  await page.getByRole('button', { name: 'Forget rig' }).click()
  await confirmation.getByRole('button', { name: 'Forget rig' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Connect your first rig' })).toBeVisible()
  expect(deleteRequests).toBe(1)
})

test('Forget focuses Cancel, blocks dismissal while pending, and submits one DELETE', async ({ page }) => {
  let deletes = 0
  let release: () => void = () => {}

  const pending = new Promise<void>(resolve => { release = resolve })
  await useHome(page, () => ({ rigs: [], refreshedAt: now }))
  await page.route('**/api/web/rigs/rig-1', route => fulfillJson(route, liveDetail()))
  await page.route('**/api/rigs/rig-1', async route => {
    deletes++
    await pending
    await route.fulfill({ status: 204, body: '' })
  })
  await page.goto('/rigs/rig-1')
  await page.locator('.equipment__rig-details summary').click()
  const opener = page.getByRole('button', { name: 'Forget rig', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Forget Backyard rig?' })
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeFocused()
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await opener.click()
  await dialog.getByRole('button', { name: 'Forget rig', exact: true }).click()
  await expect.poll(() => deletes).toBe(1)
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(dialog).toBeVisible()
  expect(deletes).toBe(1)
  release()
  await expect(page).toHaveURL(/\/$/)
  expect(deletes).toBe(1)
})

test('unknown Forget requires catalog inspection across dismissal and never repeats DELETE', async ({ page }) => {
  let deletes = 0
  let reads = 0
  let checkAvailable = false
  await page.route('**/api/web/home', route => {
    reads++

    return checkAvailable
      ? fulfillJson(route, { rigs: [], refreshedAt: now })
      : fulfillJson(route, { invalid: true })
  })
  await page.route('**/api/web/rigs/rig-1', route => fulfillJson(route, liveDetail()))
  await page.route('**/api/rigs/rig-1', async route => {
    deletes++
    await route.abort('failed')
  })
  await page.goto('/rigs/rig-1')
  await page.locator('.equipment__rig-details summary').click()
  await page.getByRole('button', { name: 'Forget rig', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Forget Backyard rig?' })
  await dialog.getByRole('button', { name: 'Forget rig', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Check saved rigs' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Forget rig', exact: true }).click()
  await expect(dialog.getByRole('button', { name: 'Forget rig', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Check saved rigs' }).click()
  await expect(dialog.getByRole('alert')).toContainText('could not be checked')
  expect(deletes).toBe(1)
  expect(reads).toBe(1)
  checkAvailable = true
  await dialog.getByRole('button', { name: 'Check saved rigs' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Connect your first rig' })).toBeVisible()
  expect(deletes).toBe(1)
  expect(reads).toBe(3)
})

test('a stalled Forget check permits dismissal without forgetting the unknown outcome', async ({ page }) => {
  let deletes = 0
  let reads = 0
  await page.route('**/api/web/home', async route => {
    reads++

    if (reads === 1) return

    await fulfillJson(route, { rigs: [], refreshedAt: now })
  })
  await page.route('**/api/web/rigs/rig-1', route => fulfillJson(route, liveDetail()))
  await page.route('**/api/rigs/rig-1', async route => {
    deletes++
    await route.abort('connectionreset')
  })
  await page.goto('/rigs/rig-1')
  await page.locator('.equipment__rig-details summary').click()
  const opener = page.getByRole('button', { name: 'Forget rig', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog', { name: 'Forget Backyard rig?' })
  await dialog.getByRole('button', { name: 'Forget rig', exact: true }).click()
  await dialog.getByRole('button', { name: 'Check saved rigs' }).click()
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled()
  await expect(dialog.getByRole('alert')).toContainText('could not be checked', { timeout: 8000 })
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
  await opener.click()
  await expect(dialog.getByRole('button', { name: 'Forget rig', exact: true })).toHaveCount(0)
  await dialog.getByRole('button', { name: 'Check saved rigs' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'Connect your first rig' })).toBeVisible()
  expect(deletes).toBe(1)
  expect(reads).toBe(3)
})
