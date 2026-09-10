import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { HomeView } from '@vela/model/web'

const endpoint = { host: '192.168.4.104', port: 11111 }

const inspectedAt = '2026-09-02T20:00:00.000Z'

function emptyHome(): HomeView {
  return { rigs: [], refreshedAt: inspectedAt }
}

function homeWithRig(reachability: 'reachable' | 'unreachable' = 'reachable'): HomeView {
  return {
    rigs: [{
      id: 'rig-1',
      name: 'Backyard rig',
      reachability,
      lastSeenAt: inspectedAt,
      connections: reachability === 'reachable'
        ? { total: 1, connected: 1, disconnected: 0, unavailable: 0 }
        : { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
      capabilities: ['forget'],
    }],
    refreshedAt: inspectedAt,
  }
}

async function fulfillJson<Body>(route: Route, body: Body, status = 200) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

async function useHome(page: Page, getHome: () => HomeView, delay = 0) {
  await page.route('**/api/web/home', async (route) => {
    if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay))
    await fulfillJson(route, getHome())
  })
}

test('adds an explicitly selected new Rig from mixed discovery results', async ({ page }) => {
  let home = emptyHome()
  let addPayload: unknown
  let addAttempts = 0
  await useHome(page, () => home, 100)
  await page.route('**/api/rigs/discovery', (route) => fulfillJson(route, {
    candidates: [
      {
        endpoint,
        server: { name: 'ASCOM Remote' },
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Main camera' }],
        disposition: { state: 'new' },
      },
      {
        endpoint: { host: '192.168.4.105', port: 11111 },
        server: { name: 'Known server' },
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Known camera' }],
        disposition: { state: 'already-added', rigId: 'rig-known' },
      },
      {
        endpoint: { host: '192.168.4.106', port: 11111 },
        server: { name: 'Conflicting server' },
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Conflicting camera' }],
        disposition: { state: 'conflict' },
      },
    ],
    failures: [{
      endpoint: { host: '192.168.4.107', port: 11111 },
      reason: 'unreachable',
    }],
  }))
  await page.route('**/api/rigs', async (route) => {
    addAttempts += 1
    addPayload = route.request().postDataJSON()

    if (addAttempts === 1) {
      await fulfillJson(route, { error: 'rig-conflict' }, 409)

      return
    }

    await new Promise((resolve) => setTimeout(resolve, 150))
    home = homeWithRig()
    await fulfillJson(route, { rigId: 'rig-1' }, 201)
  })

  await page.goto('/')
  await expect(page.getByText('Loading Rigs…')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Find your observatory rig' })).toBeVisible()
  await page.getByRole('button', { name: 'Scan for rigs' }).click()

  await expect(page.getByText('Already added')).toBeVisible()
  await expect(page.getByText('Needs attention')).toBeVisible()
  await expect(page.getByText('One server could not be inspected')).toBeVisible()
  const review = page.getByRole('button', { name: 'Review rig' })
  await expect(review).toBeDisabled()

  await page.getByRole('button', { name: /ASCOM Remote/ }).click()
  await expect(review).toBeEnabled()
  await review.click()
  await page.getByLabel('Rig name').fill('')
  await expect(page.getByRole('button', { name: 'Add rig' })).toBeDisabled()
  await page.getByLabel('Rig name').fill('Backyard rig')
  await page.getByRole('button', { name: 'Add rig' }).click()
  await expect(page.getByRole('alert')).toContainText('conflicts with another saved rig')

  await page.getByRole('button', { name: 'Add rig' }).click()
  await expect(page.getByRole('button', { name: 'Adding rig…' })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Review this rig' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Backyard rig' })).toBeVisible()
  expect(addPayload).toEqual({ name: 'Backyard rig', endpoint })
})

test('cancels stale scans and keeps useful discovery failures', async ({ page }) => {
  await useHome(page, emptyHome)
  await page.route('**/api/rigs/discovery', async (route) => {
    const request = route.request().postDataJSON()

    if (request.mode === 'scan') {
      await new Promise((resolve) => setTimeout(resolve, 300))
      await fulfillJson(route, {
        candidates: [{
          endpoint,
          inspectedAt,
          devices: [{ kind: 'camera', name: 'Late camera' }],
          disposition: { state: 'new' },
        }],
        failures: [],
      }).catch(() => {})

      return
    }

    if (request.host === 'http://bad') {
      await fulfillJson(route, { error: 'invalid-discovery-request' }, 400)

      return
    }

    if (request.host === 'malformed.local') {
      await fulfillJson(route, {})

      return
    }

    await fulfillJson(route, {
      candidates: [],
      failures: [{ endpoint: request, reason: 'unreachable' }],
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Scan for rigs' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'No Rigs configured' })).toBeVisible()
  await page.waitForTimeout(350)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Set up a rig' }).click()
  await page.getByRole('button', { name: 'Enter an address manually' }).click()
  await page.getByLabel('Host or IP address').fill('http://bad')
  await page.getByRole('button', { name: 'Inspect address' }).click()
  await expect(page.getByRole('alert')).toContainText('Enter a hostname or IPv4 address')
  await expect(page.getByLabel('Host or IP address')).toHaveValue('http://bad')

  await page.getByLabel('Host or IP address').fill('missing.local')
  await page.getByRole('button', { name: 'Inspect address' }).click()
  await expect(page.getByText('Could not inspect this address')).toBeVisible()
  await page.getByRole('button', { name: 'Change address' }).click()

  await page.getByLabel('Host or IP address').fill('malformed.local')
  await page.getByRole('button', { name: 'Inspect address' }).click()
  await expect(page.getByRole('heading', { name: 'Could not look for rigs' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Discovery request failed')
})

test('explains results when no discovered candidate can be added', async ({ page }) => {
  await useHome(page, emptyHome)
  await page.route('**/api/rigs/discovery', (route) => fulfillJson(route, {
    candidates: [
      {
        endpoint,
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Known camera' }],
        disposition: { state: 'already-added', rigId: 'rig-1' },
      },
      {
        endpoint: { host: '192.168.4.105', port: 11111 },
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Legacy camera' }],
        disposition: { state: 'ineligible', reason: 'no-stable-device-id' },
      },
      {
        endpoint: { host: '192.168.4.106', port: 11111 },
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Ambiguous camera' }],
        disposition: { state: 'conflict' },
      },
    ],
    failures: [],
  }))

  await page.goto('/')
  await page.getByRole('button', { name: 'Scan for rigs' }).click()

  await expect(page.getByText('No rigs can be added')).toBeVisible()
  await expect(page.getByText('Already added')).toBeVisible()
  await expect(page.getByText('Unavailable')).toBeVisible()
  await expect(page.getByText('Needs attention')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Review rig' })).toBeDisabled()
})

test('opens manual discovery from an existing Rig view', async ({ page }) => {
  await useHome(page, () => homeWithRig())
  let discoveryPayload: unknown
  await page.route('**/api/rigs/discovery', async (route) => {
    discoveryPayload = route.request().postDataJSON()
    await fulfillJson(route, {
      candidates: [{
        endpoint: { host: '192.168.4.63', port: 32323 },
        server: { name: 'ASCOM Alpaca' },
        inspectedAt,
        devices: [{ kind: 'camera', name: 'Seestar camera' }],
        disposition: { state: 'new' },
      }],
      failures: [],
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Add rig' }).click()
  await page.getByRole('button', { name: 'Enter an address manually' }).click()
  await page.getByLabel('Host or IP address').fill('192.168.4.63')
  await page.getByLabel('Port').fill('32323')
  await page.getByRole('button', { name: 'Inspect address' }).click()

  await expect(page.getByRole('heading', { name: 'Rig at this address' })).toBeVisible()
  await expect(page.getByRole('button', { name: /ASCOM Alpaca/ })).toBeVisible()
  expect(discoveryPayload).toEqual({
    mode: 'manual',
    host: '192.168.4.63',
    port: 32323,
  })
})

test('validates Home responses and retries an initial failure', async ({ page }) => {
  let homeRequests = 0
  await page.route('**/api/web/home', async (route) => {
    homeRequests += 1
    await new Promise((resolve) => setTimeout(resolve, 75))

    if (homeRequests === 1) {
      await fulfillJson(route, { rigs: 'not-an-array', refreshedAt: inspectedAt })

      return
    }

    await fulfillJson(route, homeWithRig('unreachable'))
  })

  await page.goto('/')
  await expect(page.getByText('Loading Rigs…')).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('could not load your rigs')
  await expect(page.getByRole('heading', { name: 'Could not load your Rigs' })).toBeVisible()
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { name: 'Backyard rig' })).toBeVisible()
  await expect(page.getByText('Offline')).toBeVisible()
  await expect(page.getByText(/Last seen/)).toBeVisible()
  expect(homeRequests).toBe(2)
})
