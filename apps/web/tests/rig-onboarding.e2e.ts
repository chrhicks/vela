import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { HomeView } from '@vela/model/web'

const endpoint = { host: '192.168.4.104', port: 11111 }

const inspectedAt = '2026-09-02T20:00:00.000Z'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) => fulfillJson(route, { error: 'Unexpected request' }, 503))
  await page.route('**/api/web/navigation', (route) =>
    fulfillJson(route, { rigs: [], captures: [] }),
  )
})

function emptyHome(): HomeView {
  return { rigs: [], refreshedAt: inspectedAt }
}

function homeWithRig(reachability: 'reachable' | 'unreachable' = 'reachable'): HomeView {
  return {
    rigs: [
      {
        id: 'rig-1',
        name: 'Backyard rig',
        reachability,
        lastSeenAt: inspectedAt,
        connections:
          reachability === 'reachable'
            ? { total: 1, connected: 1, disconnected: 0, unavailable: 0 }
            : { total: 1, connected: 0, disconnected: 0, unavailable: 1 },
        capabilities: ['forget'],
      },
    ],
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
  await page.route('**/api/rigs/discovery', (route) =>
    fulfillJson(route, {
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
      failures: [
        {
          endpoint: { host: '192.168.4.107', port: 11111 },
          reason: 'unreachable',
        },
      ],
    }),
  )
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
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await expect(page.getByRole('dialog', { name: 'Add a rig' })).toBeVisible()
  await page.getByRole('button', { name: 'Scan the network' }).click()

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
  await expect(page.getByRole('dialog', { name: 'ASCOM Remote' })).toBeVisible()
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
        candidates: [
          {
            endpoint,
            inspectedAt,
            devices: [{ kind: 'camera', name: 'Late camera' }],
            disposition: { state: 'new' },
          },
        ],
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
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Scan the network' }).click()
  await page.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('heading', { name: 'Connect your first rig' })).toBeVisible()
  await page.waitForTimeout(350)
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Enter address' }).click()
  await page.getByLabel('Host or IP address').fill('http://bad')
  await page.getByRole('button', { name: 'Find rig' }).click()
  await expect(
    page.getByText('Enter only the hostname or IP address.', { exact: false }),
  ).toBeVisible()
  await expect(page.getByLabel('Host or IP address')).toBeFocused()
  await expect(page.getByLabel('Host or IP address')).toHaveValue('http://bad')

  await page.getByLabel('Host or IP address').fill('missing.local')
  await page.getByRole('button', { name: 'Find rig' }).click()
  await expect(page.getByText('Could not reach this server')).toBeVisible()
  await expect(page.getByLabel('Host or IP address')).toHaveValue('missing.local')

  await page.getByLabel('Host or IP address').fill('malformed.local')
  await page.getByRole('button', { name: 'Find rig' }).click()
  await expect(page.getByRole('heading', { name: 'Could not look for rigs' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Discovery request failed')
})

test('explains results when no discovered candidate can be added', async ({ page }) => {
  await useHome(page, emptyHome)
  await page.route('**/api/rigs/discovery', (route) =>
    fulfillJson(route, {
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
    }),
  )

  await page.goto('/')
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Scan the network' }).click()

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
      candidates: [
        {
          endpoint: { host: '192.168.4.63', port: 32323 },
          server: { name: 'ASCOM Alpaca' },
          inspectedAt,
          devices: [{ kind: 'camera', name: 'Seestar camera' }],
          disposition: { state: 'new' },
        },
      ],
      failures: [],
    })
  })

  await page.goto('/')
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Enter address' }).click()
  await page.getByLabel('Host or IP address').fill('192.168.4.63')
  await page.getByLabel('Port').fill('32323')
  await page.getByRole('button', { name: 'Find rig' }).click()

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
  await expect(page.getByRole('heading', { name: 'Connect your first rig' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Try again' }).click()

  await expect(page.getByRole('heading', { name: 'Backyard rig' })).toBeVisible()
  await expect(page.getByText('Not reachable')).toBeVisible()
  await expect(page.getByText(/Last seen/)).toBeVisible()
  expect(homeRequests).toBe(2)
})

function discoveryCandidate(
  disposition: 'new' | 'already-added' | 'conflict' | 'ineligible' = 'new',
) {
  return {
    endpoint,
    server: { name: 'Askar FRA 400' },
    inspectedAt,
    devices: [
      { kind: 'camera', name: 'ZWO ASI2600MC Pro' },
      { kind: 'camera', name: 'ZWO ASI120MM Mini' },
      { kind: 'telescope', name: 'Sky-Watcher EQ6-R Pro' },
      { kind: 'focuser', name: 'ZWO EAF' },
    ],
    disposition: candidateDisposition(disposition),
  }
}

async function openReview(page: Page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Scan the network' }).click()
  await page.getByRole('button', { name: /Askar FRA 400/ }).click()
  await page.getByRole('button', { name: 'Review rig' }).click()
  await page.getByLabel('Rig name').fill('My observatory')
}

for (const outcome of ['saved', 'new', 'conflict', 'ineligible', 'read-failed'] as const) {
  test(`checks the exact endpoint after an ambiguous add: ${outcome}`, async ({ page }) => {
    await useHome(page, emptyHome)
    let inspections = 0
    let adds = 0
    await page.route('**/api/rigs/discovery', async (route) => {
      inspections += 1

      if (inspections === 1) {
        await fulfillJson(route, { candidates: [discoveryCandidate()], failures: [] })

        return
      }

      expect(route.request().postDataJSON()).toEqual({ mode: 'manual', ...endpoint })

      if (outcome === 'read-failed') {
        await fulfillJson(route, { error: 'unavailable' }, 503)

        return
      }

      const disposition = outcome === 'saved' ? 'already-added' : outcome
      await fulfillJson(route, { candidates: [discoveryCandidate(disposition)], failures: [] })
    })
    await page.route('**/api/rigs', async (route) => {
      adds += 1
      await fulfillJson(route, { error: 'failure-after-write' }, 500)
    })
    await openReview(page)
    await page.getByRole('button', { name: 'Add rig', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('could not be confirmed')
    await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeDisabled()
    await page.getByRole('button', { name: 'Check saved rig' }).click()

    if (outcome === 'saved') {
      await expect(page.getByRole('dialog')).toHaveCount(0)
    } else if (outcome === 'new') {
      await expect(page.getByLabel('Rig name')).toHaveValue('My observatory')
      await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeEnabled()
      await expect(page.getByRole('alert')).toContainText('not saved')
    } else if (outcome === 'read-failed') {
      await expect(page.getByRole('alert')).toContainText('still unknown')
      await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeDisabled()
    } else {
      await expect(page.getByRole('button', { name: 'Review rig' })).toBeDisabled()
      await expect(
        page.getByText(outcome === 'conflict' ? 'Needs attention' : 'Unavailable', { exact: true }),
      ).toBeVisible()
    }

    expect(adds).toBe(1)
    expect(inspections).toBe(2)
  })
}

for (const failure of ['transport', 'malformed'] as const) {
  test(`does not repeat an add after ${failure} response`, async ({ page }) => {
    await useHome(page, emptyHome)
    await page.route('**/api/rigs/discovery', (route) =>
      fulfillJson(route, { candidates: [discoveryCandidate()], failures: [] }),
    )
    let adds = 0
    await page.route('**/api/rigs', async (route) => {
      adds += 1

      if (failure === 'transport') await route.abort('connectionreset')
      else await fulfillJson(route, { unexpected: true })
    })
    await openReview(page)
    await page.getByRole('button', { name: 'Add rig', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Check saved rig' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeDisabled()
    expect(adds).toBe(1)
  })
}

test('a stalled saved-rig check restores controls and preserves the unknown Add outcome', async ({ page }) => {
  await useHome(page, emptyHome)
  let inspections = 0
  let adds = 0
  await page.route('**/api/rigs/discovery', async route => {
    inspections++

    if (inspections === 2) return

    await fulfillJson(route, {
      candidates: [discoveryCandidate(inspections === 1 ? 'new' : 'already-added')],
      failures: [],
    })
  })
  await page.route('**/api/rigs', async route => {
    adds++
    await route.abort('connectionreset')
  })
  await openReview(page)
  await page.getByRole('button', { name: 'Add rig', exact: true }).click()
  await page.getByRole('button', { name: 'Check saved rig', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Checking saved rig…' })).toBeDisabled()
  await expect(page.getByRole('alert')).toContainText('still unknown', { timeout: 8000 })
  await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Close dialog' })).toBeEnabled()
  await expect(page.getByLabel('Rig name')).toHaveValue('My observatory')
  await page.getByRole('button', { name: 'Check saved rig', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(adds).toBe(1)
  expect(inspections).toBe(3)
})

test('retains review and address drafts through Back, and keeps confirmed add after failed Home refresh', async ({
  page,
}) => {
  let added = false
  let adds = 0
  await page.route('**/api/web/home', (route) =>
    added ? fulfillJson(route, { error: 'unavailable' }, 503) : fulfillJson(route, homeWithRig()),
  )
  await page.route('**/api/rigs/discovery', (route) =>
    fulfillJson(route, { candidates: [discoveryCandidate()], failures: [] }),
  )
  await page.route('**/api/rigs', async (route) => {
    adds += 1
    added = true
    await fulfillJson(route, { rigId: 'new-rig' }, 201)
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Enter address' }).click()
  await page.getByLabel('Host or IP address').fill(endpoint.host)
  await page.getByLabel('Port').fill(String(endpoint.port))
  await page.getByRole('button', { name: 'Back to network scan' }).click()
  await page.getByRole('button', { name: 'Enter address' }).click()
  await expect(page.getByLabel('Host or IP address')).toHaveValue(endpoint.host)
  await page.getByRole('button', { name: 'Find rig' }).click()
  await page.getByRole('button', { name: /Askar FRA 400/ }).click()
  await page.getByRole('button', { name: 'Review rig' }).click()
  await page.getByLabel('Rig name').fill('Edited name')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: 'Review rig' }).click()
  await expect(page.getByLabel('Rig name')).toHaveValue('Edited name')
  await page.getByRole('button', { name: 'Add rig', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Showing the previous state')
  await expect(page.getByRole('heading', { name: 'Backyard rig' })).toBeVisible()
  expect(adds).toBe(1)
})

test('phone address validation keeps field focus, modal containment, and source geometry', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 782 })
  await useHome(page, emptyHome)
  const requests: string[] = []
  await page.route('**/api/rigs/discovery', (route) => {
    requests.push(route.request().url())

    return fulfillJson(route, {})
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Add a rig' }).click()
  await page.getByRole('button', { name: 'Enter address' }).click()
  await page.getByLabel('Host or IP address').fill('http://192.168.4.104')
  await page.getByRole('button', { name: 'Find rig' }).click()
  const host = page.getByLabel('Host or IP address')
  await expect(host).toHaveAttribute('aria-invalid', 'true')
  await expect(host).toBeFocused()
  await expect(host).toHaveAttribute('aria-describedby', /message/)
  await expect(page.getByLabel('Port')).toHaveValue('11111')
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations().filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity).map(animation => animation.finished.catch(() => {})))
  })
  await page.screenshot({ path: '/tmp/vela-onboarding-phone-validation.png' })
  const bounds = await host.boundingBox()
  expect(bounds?.x).toBe(20)
  expect(bounds?.width).toBe(350)
  expect(bounds?.height).toBe(46)
  expect(
    await page
      .locator('.vela-rig-onboarding__content')
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true)
  await host.fill(endpoint.host)
  await page.getByLabel('Port').fill('0')
  await page.getByRole('button', { name: 'Find rig' }).click()
  await expect(page.getByLabel('Port')).toBeFocused()
  await expect(page.getByLabel('Port')).toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Add a rig' })).toBeFocused()
  expect(requests).toEqual([])
})

function candidateDisposition(state: 'new' | 'already-added' | 'conflict' | 'ineligible') {
  if (state === 'already-added') return { state, rigId: 'rig-1' }

  if (state === 'ineligible') return { state, reason: 'no-stable-device-id' }

  return { state }
}

test('keeps edited names with their inspected endpoint', async ({ page }) => {
  await useHome(page, emptyHome)
  const other = { ...discoveryCandidate(), endpoint: { host: 'other.local', port: 11111 }, server: { name: 'Other observatory' } }
  await page.route('**/api/rigs/discovery', route => fulfillJson(route, { candidates: [discoveryCandidate(), other], failures: [] }))
  await openReview(page)
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: /Other observatory/ }).click()
  await page.getByRole('button', { name: 'Review rig' }).click()
  await expect(page.getByLabel('Rig name')).toHaveValue('Other observatory')
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await page.getByRole('button', { name: /Askar FRA 400/ }).click()
  await page.getByRole('button', { name: 'Review rig' }).click()
  await expect(page.getByLabel('Rig name')).toHaveValue('My observatory')
})

for (const status of [400, 404, 409]) {
  test(`known ${status} rejection stays distinct from an unknown add`, async ({ page }) => {
    await useHome(page, emptyHome)
    await page.route('**/api/rigs/discovery', route => fulfillJson(route, { candidates: [discoveryCandidate()], failures: [] }))
    await page.route('**/api/rigs', route => fulfillJson(route, { error: 'rejected' }, status))
    await openReview(page)
    await page.getByRole('button', { name: 'Add rig', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('rejected')
    await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Check saved rig' })).toHaveCount(0)
  })
}

test('already-added rejection provides a working catalog handoff', async ({ page }) => {
  await useHome(page, emptyHome)
  let checks = 0
  let adds = 0
  await page.route('**/api/rigs/discovery', route => {
    checks += 1

    return fulfillJson(route, { candidates: [discoveryCandidate(checks === 1 ? 'new' : 'already-added')], failures: [] })
  })
  await page.route('**/api/rigs', route => {
    adds += 1

    return fulfillJson(route, { error: 'rig-already-added' }, 409)
  })
  await openReview(page)
  await page.getByRole('button', { name: 'Add rig', exact: true }).click()
  await page.getByRole('button', { name: 'Check saved rig' }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  expect(adds).toBe(1)
})

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 900, 390]) {
    test(`review and address layouts ${mode} ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 390 ? 782 : 900 })
      await page.addInitScript(value => localStorage.setItem('vela.appearance', value), mode)
      await useHome(page, emptyHome)
      await page.route('**/api/rigs/discovery', route => fulfillJson(route, { candidates: [discoveryCandidate()], failures: [] }))
      await openReview(page)
      await page.getByLabel('Rig name').fill('Askar FRA 400')
      await page.getByRole('dialog').focus()
      await settledLayout(page)
      await page.screenshot({ path: `/tmp/vela-onboarding-review-${width}-${mode}.png` })
      const modal = page.getByRole('dialog')

      if (width === 1440) {
        const bounds = await modal.boundingBox()
        expect(bounds?.x).toBe(408)
        expect(bounds?.y).toBe(128)
        expect(bounds?.width).toBe(624)
        expect(bounds?.height).toBe(616)
      }

      await expect(page.getByRole('button', { name: 'Add rig', exact: true })).toBeEnabled()

      for (let index = 0; index < 7; index += 1) {
        await page.keyboard.press('Tab')
        expect(await modal.evaluate(element => element.contains(document.activeElement))).toBe(true)
      }

      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Add a rig' })).toBeFocused()
      await page.getByRole('button', { name: 'Add a rig' }).click()
      await page.getByRole('button', { name: 'Enter address' }).click()
      await page.getByLabel('Host or IP address').fill('http://192.168.4.104')
      await page.getByRole('button', { name: 'Find rig' }).click()
      await expect(page.getByLabel('Host or IP address')).toBeFocused()
      await settledLayout(page)
      await page.screenshot({ path: `/tmp/vela-onboarding-address-focused-${width}-${mode}.png` })
      // The source address board shows the invalid field after keyboard dismissal.
      await modal.focus()
      await page.mouse.move(0, 0)
      await settledLayout(page)
      await page.screenshot({ path: `/tmp/vela-onboarding-address-${width}-${mode}.png` })
      expect(await modal.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    })
  }
}

async function settledLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))
  })
}

for (const mode of ['light', 'dark'] as const) {
  test(`empty scan and unreachable address keep useful next actions ${mode}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 782 })
    await page.addInitScript(value => localStorage.setItem('vela.appearance', value), mode)
    await useHome(page, emptyHome)
    const inspections: unknown[] = []
    let mixedFailure = false
    await page.route('**/api/rigs/discovery', route => {
      const request = route.request().postDataJSON()
      inspections.push(request)

      if (request.mode === 'scan') return fulfillJson(route, { candidates: [], failures: [] })

      const failures = [{ endpoint, reason: 'unreachable' }]

      if (mixedFailure) failures.push({ endpoint, reason: 'protocol-error' })

      return fulfillJson(route, { candidates: [], failures })
    })
    await page.goto('/')
    await page.getByRole('button', { name: 'Add a rig' }).click()
    await page.getByRole('button', { name: 'Scan the network' }).click()
    await expect(page.getByRole('heading', { name: 'No rigs found on your network' })).toBeVisible()
    await settledLayout(page)
    await page.screenshot({ path: `/tmp/vela-onboarding-empty-390-${mode}.png` })
    await page.getByRole('button', { name: 'Enter address' }).click()
    await page.getByLabel('Host or IP address').fill(endpoint.host)
    await page.getByLabel('Port').fill(String(endpoint.port))
    await page.getByRole('button', { name: 'Find rig' }).click()
    await expect(page.getByText('Could not reach this server')).toBeVisible()
    await expect(page.getByLabel('Host or IP address')).toHaveValue(endpoint.host)
    await expect(page.getByLabel('Port')).toHaveValue(String(endpoint.port))
    await settledLayout(page)
    await page.screenshot({ path: `/tmp/vela-onboarding-unreachable-390-${mode}.png` })
    mixedFailure = true
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('The server reported an Alpaca error.')).toBeVisible()
    await expect(page.getByText('Could not reach this server')).toHaveCount(0)
    expect(inspections).toEqual([{ mode: 'scan' }, { mode: 'manual', ...endpoint }, { mode: 'manual', ...endpoint }])
  })
}
