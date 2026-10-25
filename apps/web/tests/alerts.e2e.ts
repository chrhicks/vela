import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { AlertsView, HomeView, NavigationView, RigDetailView } from '@vela/model/web'
import { reviewCapture } from './fixtures/fieldroom/tonight'

test.use({ locale: 'en-GB', timezoneId: 'UTC' })

const raisedAt = Date.parse('2026-10-18T03:31:00Z')

const navigation: NavigationView = {
  rigs: [{ id: 'rig-1', name: 'Backyard rig' }],
  captures: [
    {
      rigId: 'rig-1',
      rigName: 'Backyard rig',
      phase: 'exposing',
      active: true,
      captureReadState: 'current',
      completedCount: 17,
      elapsedSeconds: 18,
      exposureSeconds: 60,
      error: null,
    },
  ],
}

const home: HomeView = {
  rigs: [
    {
      id: 'rig-1',
      name: 'Backyard rig',
      reachability: 'reachable',
      lastSeenAt: new Date().toISOString(),
      connections: { total: 1, connected: 1, disconnected: 0, unavailable: 0 },
      capabilities: [],
    },
  ],
  refreshedAt: new Date().toISOString(),
}

const detail: RigDetailView = {
  id: 'rig-1',
  name: 'Backyard rig',
  state: 'reachable',
  endpoint: { host: '192.168.4.104', port: 11111 },
  addedAt: new Date().toISOString(),
  lastInventoryAt: new Date().toISOString(),
  refreshedAt: new Date().toISOString(),
  connections: { total: 0, connected: 0, disconnected: 0, unavailable: 0 },
  devices: [],
  capabilities: [],
}

const collapsed: AlertsView['alerts'][number] = {
  id: 'stars-collapsed',
  level: 'critical',
  message: 'Stars dropped from about 1100 to 0',
  raisedAt,
  acknowledged: false,
  delivery: { state: 'sent' },
}

function alertsView(patch: Partial<AlertsView> = {}): AlertsView {
  return {
    rigId: 'rig-1',
    watching: true,
    alerts: [],
    unavailable: [],
    phone: { state: 'ready' },
    phoneAlertsOn: true,
    pagingWindow: { state: 'astro-dark', until: null },
    thresholds: { starsCollapsedRatio: 0.3, hfrBadPixels: 6, meridianNearMinutes: 20 },
    ...patch,
  }
}

async function useRig(page: Page, initial: AlertsView) {
  let current = initial
  const posts: string[] = []

  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.route('**/api/web/navigation', route => route.fulfill({ json: navigation }))
  await page.route('**/api/web/home', route => route.fulfill({ json: home }))
  await page.route('**/api/web/rigs/rig-1', route => route.fulfill({ json: detail }))

  await page.route('**/api/web/rigs/rig-1/capture', route =>
    route.fulfill({ json: { ...reviewCapture, rigId: 'rig-1', subject: null, latestImage: null } }),
  )

  await page.route('**/api/web/rigs/rig-1/alerts', route => route.fulfill({ json: current }))

  await page.route('**/api/rigs/rig-1/alerts/stars-collapsed/acknowledge', route => {
    posts.push('acknowledge')
    current = { ...current, alerts: current.alerts.map(alert => ({ ...alert, acknowledged: true })) }

    return route.fulfill({ json: current })
  })

  await page.route('**/api/rigs/rig-1/alerts/phone', route => {
    const on = route.request().postDataJSON().on === true

    posts.push(on ? 'phone-on' : 'phone-off')
    current = {
      ...current,
      phoneAlertsOn: on,
      alerts: current.alerts.map(alert => (on ? alert : { ...alert, delivery: { state: 'muted' } })),
    }

    return route.fulfill({ json: current })
  })

  await page.route('**/api/rigs/rig-1/alerts/test', route => {
    posts.push('test')

    return route.fulfill({ status: 502, json: { error: 'phone-alerts-failing', reason: 'Pushover answered 500' } })
  })

  return {
    posts,
    set(next: AlertsView) {
      current = next
    },
    /** The server goes away: every request fails until the returned function is called. */
    async outage() {
      const down = (route: Route) => route.fulfill({ status: 503, json: { error: 'Server down' } })

      await page.route('**/api/**', down)

      return () => page.unroute('**/api/**', down)
    },
  }
}

test('a critical alert shows on every page, and acknowledging keeps it until it clears', async ({ page }) => {
  const rig = await useRig(page, alertsView({ alerts: [collapsed] }))
  const banner = page.getByRole('region', { name: 'Rig alerts' })

  for (const path of ['/rigs/rig-1/observe', '/rigs/rig-1', '/']) {
    await page.goto(path)
    await expect(banner.getByRole('alert')).toContainText('Critical')
    await expect(banner).toContainText('Stars dropped from about 1100 to 0')
    await expect(banner).toContainText('Raised 03:31')
    await expect(banner).toContainText('repeating on your phone until acknowledged')
  }

  await page.goto('/rigs/rig-1/observe')
  await banner.getByRole('button', { name: /^Acknowledge/ }).click()

  await expect(banner).toContainText('Acknowledged')
  await expect(banner).toContainText('Stars dropped from about 1100 to 0')
  await expect(banner).not.toContainText('repeating on your phone')
  await expect(banner.getByRole('button', { name: /^Acknowledge/ })).toHaveCount(0)
  expect(rig.posts).toEqual(['acknowledge'])

  rig.set(alertsView())
  await expect(banner).toHaveCount(0)
})

test('a quiet rig shows no banner, and a warning is labelled in words', async ({ page }) => {
  const rig = await useRig(page, alertsView())
  await page.goto('/rigs/rig-1/observe')
  await expect(page.getByRole('region', { name: 'Alerts' })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Rig alerts' })).toHaveCount(0)

  rig.set(
    alertsView({
      alerts: [{ ...collapsed, id: 'hfr-high', level: 'warn', message: 'Stars are softening (HFR 4.3 px)' }],
    }),
  )

  const warning = page.getByRole('region', { name: 'Rig alerts' }).getByRole('status').filter({ hasText: 'Warning' })
  await expect(warning).toContainText('Stars are softening (HFR 4.3 px)')
})

test('the rig page card shows the phone failing, each alert’s delivery and the watches that cannot run', async ({ page }) => {
  const rig = await useRig(
    page,
    alertsView({
      alerts: [
        {
          ...collapsed,
          delivery: {
            state: 'retrying',
            failures: 2,
            nextAttemptAt: Date.parse('2026-10-18T03:35:00Z'),
            giveUpAt: Date.parse('2026-10-18T04:31:00Z'),
          },
        },
      ],
      unavailable: ['meridian watch unavailable: pier side'],
      phone: { state: 'failing', reason: 'Pushover answered 500', since: Date.parse('2026-10-18T03:32:00Z') },
    }),
  )

  await page.goto('/rigs/rig-1')
  const card = page.getByRole('region', { name: 'Alerts', exact: true })

  await expect(card).toContainText('Phone alerts failing: Pushover answered 500 · since 03:32')
  await expect(card).toContainText('Stars dropped from about 1100 to 0')
  await expect(card).toContainText('Phone has not taken it (2×) · trying again at 03:35')
  await expect(card).toContainText('meridian watch unavailable: pier side')

  await card.getByText('Thresholds in use').click()
  await expect(card).toContainText('HFR bad (critical) above')
  await expect(card).toContainText('6 px')

  await card.getByRole('button', { name: 'Send test' }).click()
  await expect(card).toContainText('The test was not sent: Pushover answered 500.')
  expect(rig.posts).toEqual(['test'])
})

test('without phone keys the card says so and does not offer a test it cannot send', async ({ page }) => {
  await useRig(page, alertsView({ phone: { state: 'not-configured' }, watching: false }))
  await page.goto('/rigs/rig-1')
  const card = page.getByRole('region', { name: 'Alerts', exact: true })

  await expect(card).toContainText('Phone alerts are not set up · alerts show here only')
  await expect(card).toContainText('Not watching · starts with a capture run')
  await expect(card).toContainText('No active alerts, and nothing is being checked.')
  await expect(card.getByRole('button', { name: 'Send test' })).toBeDisabled()
})

test('the card switches phone alerts off and on, and says which', async ({ page }) => {
  const rig = await useRig(page, alertsView({ alerts: [collapsed] }))
  await page.goto('/rigs/rig-1')
  const card = page.getByRole('region', { name: 'Alerts', exact: true })
  const banner = page.getByRole('region', { name: 'Rig alerts' })

  await expect(card).toContainText('Phone alerts: on')
  await expect(banner).not.toContainText('Phone alerts: off')

  await card.getByRole('button', { name: 'Turn off' }).click()

  await expect(card).toContainText('Phone alerts: off')
  await expect(card).toContainText('Not sent · phone alerts are off')
  await expect(banner).toContainText('Phone alerts: off')
  await expect(banner).toContainText('Stars dropped from about 1100 to 0')
  await expect(card.getByRole('button', { name: 'Send test' })).toBeDisabled()
  await expect(card).toContainText('Turn phone alerts on to send a test.')

  await card.getByRole('button', { name: 'Turn on' }).click()

  await expect(card).toContainText('Phone alerts: on')
  await expect(banner).not.toContainText('Phone alerts: off')
  expect(rig.posts).toEqual(['phone-off', 'phone-on'])
})

test('a quiet rig with phone alerts off says so on the capture page, on a phone-width screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })

  const rig = await useRig(page, alertsView({ phoneAlertsOn: false }))
  await page.goto('/rigs/rig-1/observe')
  const banner = page.getByRole('region', { name: 'Rig alerts' })

  await expect(banner).toContainText('Phone alerts: off')
  await expect(banner).toContainText('alerts show here only')
  await expect(banner.getByRole('button', { name: 'Turn on' })).toBeInViewport()

  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)

  await banner.getByRole('button', { name: 'Turn on' }).click()
  await expect(banner).toHaveCount(0)
  expect(rig.posts).toEqual(['phone-on'])
})

test('the capture page switches phone alerts off and on, on a phone-width screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })

  const rig = await useRig(page, alertsView())
  await page.goto('/rigs/rig-1/observe/capture')
  const banner = page.getByRole('region', { name: 'Rig alerts' })

  await expect(banner).toContainText('Phone alerts: on')
  await expect(banner.getByRole('button', { name: 'Turn off' })).toBeInViewport()

  await banner.getByRole('button', { name: 'Turn off' }).click()

  await expect(banner).toContainText('Phone alerts: off')
  await expect(banner).toContainText('alerts show here only')
  await banner.getByRole('button', { name: 'Turn on' }).click()

  await expect(banner).toContainText('Phone alerts: on')
  await expect(banner.getByRole('button', { name: 'Turn off' })).toBeInViewport()

  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)
  expect(rig.posts).toEqual(['phone-off', 'phone-on'])
})

test('the capture page says when the phone is paged, and an alert held for darkness says so, on a phone-width screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 })

  const dusk = Date.parse('2026-10-25T19:42:00')
  const dawn = Date.parse('2026-10-26T05:31:00')
  const held = { ...collapsed, delivery: { state: 'outside-dark' } } as const

  const rig = await useRig(page, alertsView({ alerts: [held], pagingWindow: { state: 'not-dark', from: dusk, until: dawn } }))
  await page.goto('/rigs/rig-1/observe/capture')
  const banner = page.getByRole('region', { name: 'Rig alerts' })

  await expect(banner).toContainText(/Phone alerts: on · pages in astro dark, .+ to .+/)
  await expect(banner.getByRole('button', { name: 'Turn off' })).toBeInViewport()

  const width = await page.evaluate(() => document.documentElement.scrollWidth)
  expect(width).toBeLessThanOrEqual(390)

  rig.set(alertsView({ pagingWindow: { state: 'astro-dark', until: dawn } }))
  await expect(banner).toContainText(/Phone alerts: on · paging now \(astro dark until .+\)/)

  rig.set(alertsView({ pagingWindow: { state: 'site-unknown' } }))
  await expect(banner).toContainText('Phone alerts: on · pages at any hour · rig location unknown')

  rig.set(alertsView({ alerts: [held], pagingWindow: { state: 'not-dark', from: dusk, until: dawn } }))
  await page.goto('/rigs/rig-1')
  await expect(page.getByRole('region', { name: 'Alerts', exact: true })).toContainText('Not sent · outside astro dark')
})

test('without phone keys there is no switch, since there is no phone to hold back', async ({ page }) => {
  await useRig(page, alertsView({ phone: { state: 'not-configured' }, phoneAlertsOn: false }))
  await page.goto('/rigs/rig-1')

  await expect(page.getByRole('region', { name: 'Alerts', exact: true })).toContainText('Phone alerts are not set up')
  await expect(page.getByRole('button', { name: /^Turn (on|off)$/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Rig alerts' })).toHaveCount(0)
})

test('a known critical alert stays on screen through navigation while the server is unreachable', async ({ page }) => {
  const rig = await useRig(page, alertsView({ alerts: [collapsed] }))
  const banner = page.getByRole('region', { name: 'Rig alerts' })

  await page.goto('/rigs/rig-1/observe')
  await expect(banner).toContainText('Stars dropped from about 1100 to 0')

  const restore = await rig.outage()

  await expect(banner).toContainText('Alert checks interrupted')
  await expect(banner.getByRole('button', { name: /^Acknowledge/ })).toBeDisabled()

  const settled = async () => {
    await page.waitForTimeout(1500)
    await expect(banner).toContainText('Alert checks interrupted')
    await expect(banner).toContainText('Stars dropped from about 1100 to 0')
    await expect(banner.getByRole('button', { name: /^Acknowledge/ })).toBeDisabled()
  }

  for (const link of ['Vela · all rigs', 'Explore the sky']) {
    await page.getByRole('link', { name: link, exact: true }).click()
    await settled()
  }

  for (let step = 0; step < 2; step++) {
    await page.goBack()
    await settled()
  }

  await expect(page).toHaveURL('/rigs/rig-1/observe')

  await restore()
  await expect(banner).not.toContainText('Alert checks interrupted')
  await expect(banner.getByRole('button', { name: /^Acknowledge/ })).toBeEnabled()
})

test('one loop polls each rig’s alerts, however React sets the page up', async ({ page }) => {
  const polls: number[] = []

  await useRig(page, alertsView())
  await page.route('**/api/web/rigs/rig-1/alerts', route => {
    polls.push(Date.now())

    return route.fulfill({ json: alertsView() })
  })

  await page.goto('/rigs/rig-1/observe')
  await expect.poll(() => polls.length, { timeout: 8000 }).toBeGreaterThanOrEqual(5)

  const gaps = polls.slice(1).map((at, index) => at - polls[index]!)

  expect(Math.min(...gaps)).toBeGreaterThan(800)
})

test('a rig’s remembered alert is not shown as current once it is no longer being checked', async ({ page }) => {
  await useRig(page, alertsView({ alerts: [collapsed] }))
  await page.route('**/api/web/navigation', route =>
    route.fulfill({
      json: {
        ...navigation,
        rigs: [...navigation.rigs, { id: 'rig-2', name: 'Seestar S30' }],
      } satisfies NavigationView,
    }),
  )
  await page.route('**/api/web/rigs/rig-2/alerts', route => route.fulfill({ json: alertsView({ rigId: 'rig-2' }) }))

  const banner = page.getByRole('region', { name: 'Rig alerts' })

  await page.goto('/rigs/rig-1/observe')
  await expect(banner).toContainText('Stars dropped from about 1100 to 0')
  await expect(banner).not.toContainText('Alert checks interrupted')

  await page.getByRole('combobox', { name: /Viewing rig/ }).selectOption('rig-2')
  await expect(page).toHaveURL(/rig-2/)
  await expect(banner).toHaveCount(0)

  let release!: () => void
  const held = new Promise<void>(resolve => (release = resolve))

  await page.route('**/api/web/rigs/rig-1/alerts', async route => {
    await held
    await route.fulfill({ json: alertsView({ alerts: [collapsed] }) })
  })

  await page.getByRole('combobox', { name: /Viewing rig/ }).selectOption('rig-1')
  await expect(banner).toContainText('Stars dropped from about 1100 to 0')
  await expect(banner).toContainText('Alert checks interrupted')
  await expect(banner.getByRole('button', { name: /^Acknowledge/ })).toBeDisabled()

  release()
  await expect(banner).not.toContainText('Alert checks interrupted')
  await expect(banner.getByRole('button', { name: /^Acknowledge/ })).toBeEnabled()
})
