import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { HomeView, RigDetailView } from '@vela/model/web'

const now = new Date().toISOString()
const endpoint = { host: '192.168.4.104', port: 11111 }

function homeWithRig(): HomeView {
  return {
    rigs: [{
      id: 'rig-1',
      name: 'Backyard rig',
      reachability: 'reachable',
      lastSeenAt: now,
      connections: { total: 7, connected: 7, disconnected: 0, unavailable: 0 },
      capabilities: ['forget'],
    }],
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
    devices: [{
      id: 'offline-camera-0',
      kind: 'camera',
      name: 'Camera slot',
      configuredName: 'Camera slot',
      connection: 'unavailable',
      status: { availability: 'unavailable' },
    }],
    capabilities: ['forget'],
  }
}

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function useHome(page: Page, getHome: () => HomeView) {
  await page.route('**/api/web/home', (route) => fulfillJson(route, getHome()))
}

test('navigates through the complete Rig card and renders ordered responsive detail', async ({ page }) => {
  await useHome(page, homeWithRig)
  await page.route('**/api/web/rigs/rig-1', (route) => fulfillJson(route, liveDetail()))

  await page.goto('/')
  const rigLink = page.getByRole('link', { name: 'View Backyard rig' })
  await expect(rigLink).toBeVisible()
  await expect(rigLink.getByText('7 of 7')).toBeVisible()
  await rigLink.click()

  await expect(page).toHaveURL(/\/rigs\/rig-1$/)
  await expect(page.getByRole('link', { name: 'Rigs' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('heading', { level: 1, name: 'Backyard rig' })).toBeVisible()
  await expect(page.locator('.vela-rig-device .vela-panel__title')).toHaveText([
    'Mount',
    'Main camera',
    'Guide camera',
    'Focuser',
    'Filter wheel',
    'Weather sensor',
    'Power box',
  ])
  await expect(page.getByText('Some values could not be read')).toBeVisible()
  await expect(page.getByText('Input Voltage')).toBeVisible()
  await expect(page.getByText('12.9', { exact: true })).toBeVisible()
  await expect(page.getByText('12.9 V', { exact: true })).toHaveCount(0)

  const details = page.getByRole('button', { name: /Rig details/ })
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await expect(page.getByText('192.168.4.104:11111', { exact: true })).toBeVisible()

  await page.setViewportSize({ width: 390, height: 844 })
  await expect.poll(() => page.locator('.vela-rig-device-grid').evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  await expect.poll(() => page.locator('.vela-rig-device__metrics').first().evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2)
})

test('shows active refresh, retains stale values, and resumes non-overlapping polling', async ({ page }) => {
  let requests = 0
  await page.route('**/api/web/rigs/rig-1', async (route) => {
    requests += 1
    if (requests === 2) {
      await new Promise((resolve) => setTimeout(resolve, 5_500))
      await fulfillJson(route, { error: 'temporary' }, 503)
      return
    }
    await fulfillJson(route, liveDetail(requests >= 3 ? -4 : -5))
  })

  await page.goto('/rigs/rig-1')
  await expect(page.getByText('-5.0 °C')).toBeVisible()

  await page.getByRole('button', { name: 'Refresh Rig' }).click()
  const refreshing = page.getByRole('button', { name: 'Refreshing Rig' })
  await expect(refreshing).toBeDisabled()
  await expect(refreshing.locator('svg')).toHaveCSS('animation-name', 'vela-rig-refresh-spin')
  await page.waitForTimeout(5_100)
  expect(requests).toBe(2)
  await expect(refreshing).toBeDisabled()
  await expect(page.getByRole('status')).toContainText('Live updates are interrupted')
  await expect(page.getByText('-5.0 °C')).toBeVisible()
  await expect(page.getByText('Last known').first()).toBeVisible()
  expect(requests).toBe(2)

  await page.getByRole('button', { name: 'Refresh Rig' }).click()
  await expect(page.getByText('-4.0 °C')).toBeVisible()
  await expect(page.getByText('Live updates are interrupted')).toHaveCount(0)
  expect(requests).toBe(3)

  await expect.poll(() => requests, { timeout: 6_500 }).toBeGreaterThanOrEqual(4)
})

test('pauses polling while hidden and refreshes immediately when visible', async ({ page }) => {
  let requests = 0
  await page.route('**/api/web/rigs/rig-1', async (route) => {
    requests += 1
    await fulfillJson(route, liveDetail())
  })

  await page.goto('/rigs/rig-1')
  await expect(page.getByRole('heading', { level: 1, name: 'Backyard rig' })).toBeVisible()
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
  await page.route('**/api/web/rigs/*', async (route) => {
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
  await expect(page.getByRole('status')).toContainText('This Rig is offline')
  await expect(page.getByText('Status unavailable')).toBeVisible()
  await expect(page.getByText('Unavailable', { exact: true })).toBeVisible()

  await page.goto('/rigs/missing')
  await expect(page.getByRole('heading', { name: 'Rig not found' })).toBeVisible()

  await page.goto('/rigs/malformed')
  await expect(page.getByRole('heading', { name: 'Could not load this Rig' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
})

test('forgets from the secondary management area and returns Home', async ({ page }) => {
  let forgotten = false
  let deleteRequests = 0
  await useHome(page, () => forgotten ? { rigs: [], refreshedAt: now } : homeWithRig())
  await page.route('**/api/web/rigs/rig-1', (route) => fulfillJson(route, liveDetail()))
  await page.route('**/api/rigs/rig-1', async (route) => {
    deleteRequests += 1
    forgotten = true
    await route.fulfill({ status: 204, body: '' })
  })

  await page.goto('/rigs/rig-1')
  await page.getByRole('button', { name: 'Forget rig' }).click()
  const confirmation = page.getByRole('dialog', { name: 'Forget Backyard rig?' })
  await expect(confirmation).toContainText('does not change the Alpaca server or any hardware')
  await confirmation.getByRole('button', { name: 'Cancel' }).click()
  expect(deleteRequests).toBe(0)

  await page.getByRole('button', { name: 'Forget rig' }).click()
  await confirmation.getByRole('button', { name: 'Forget rig' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { name: 'No Rigs configured' })).toBeVisible()
  expect(deleteRequests).toBe(1)
})
