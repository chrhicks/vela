import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
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

  await page.route('**/api/rigs/rig-1/alerts/test', route => {
    posts.push('test')

    return route.fulfill({ status: 502, json: { error: 'phone-alerts-failing', reason: 'Pushover answered 500' } })
  })

  return {
    posts,
    set(next: AlertsView) {
      current = next
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
