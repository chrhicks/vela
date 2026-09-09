import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { TargetDiscoveryView } from '@vela/model/web'

const saved: TargetDiscoveryView = {
  rigId: 'rig-1', rigName: 'Test rig', snapshotId: 'night-original', calculatedAt: '2026-09-08T02:00:00.000Z',
  status: 'available', night: { startsAt: '2026-09-08T02:00:00.000Z', endsAt: '2026-09-08T09:00:00.000Z', kind: 'current-night' },
  site: { latitudeDegrees: 40, longitudeDegrees: -75 }, siteUnavailableReason: null,
  query: '', category: 'all', filter: 'all', offset: 0, pageSize: 2, total: 6,
  targets: [{ id: 'm31', name: 'Andromeda Galaxy', catalog: 'M31', kind: 'Galaxy', raDegrees: 10.6847, decDegrees: 41.269, sizeArcminutes: 178, thumbnailUrl: '/api/survey/thumbnail?ra=10&dec=41&fov=3', sky: null,
    category: 'galaxy', filterChoice: 'broadband', filterReason: 'Broadband preserves the galaxy’s starlight.',
    opportunity: { startsAt: '2026-09-08T02:00:00.000Z', endsAt: '2026-09-08T07:00:00.000Z', usefulMinutes: 300, bestAt: '2026-09-08T05:00:00.000Z', bestAltitudeDegrees: 80, currentAltitudeDegrees: 48 } }],
}
async function seed(page: Page) {
  await page.addInitScript(value => localStorage.setItem('vela:target-discovery:v1:rig-1', JSON.stringify(value)), saved)
  await page.route('**/api/survey/**', route => route.abort())
}
function response(url: URL, snapshotId = saved.snapshotId): TargetDiscoveryView {
  return { ...saved, snapshotId, query: url.searchParams.get('q') ?? '', category: (url.searchParams.get('category') ?? 'all') as TargetDiscoveryView['category'], filter: (url.searchParams.get('filter') ?? 'all') as TargetDiscoveryView['filter'], offset: Number(url.searchParams.get('offset') ?? 0) }
}

test('saved suggestions paint on reload without recalculating, including on a phone', async ({ page }) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  let requests = 0
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', route => {
    requests++
    return route.abort()
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' })).toBeVisible()
  await expect(page.getByText(/Saved suggestions/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  expect(requests).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('type, light preference and page preserve the calculation; Refresh resets the page and gets a new one', async ({ page }) => {
  await seed(page)
  const requests: URL[] = []
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', route => {
    const url = new URL(route.request().url())
    requests.push(url)
    const next = response(url, url.searchParams.has('snapshot') ? 'night-original' : 'night-refreshed')
    return route.fulfill({ json: next })
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await page.getByRole('button', { name: 'Galaxies', exact: true }).click()
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Broadband subjects', exact: true }).click()
  await expect.poll(() => requests.length).toBe(2)
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(page.getByLabel('Target pages')).toContainText('3–4 of 6')
  expect(requests.map(url => url.searchParams.get('snapshot'))).toEqual(['night-original', 'night-original', 'night-original'])
  expect(requests[2]!.searchParams.get('offset')).toBe('2')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(page.getByLabel('Target pages')).toContainText('1–2 of 6')
  expect(requests.at(-1)!.searchParams.has('snapshot')).toBe(false)
  expect(requests.at(-1)!.searchParams.get('offset')).toBe('0')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('vela:target-discovery:v1:rig-1')!).snapshotId)).toBe('night-refreshed')
})

for (const status of [503, 410]) {
  test(`${status} keeps the previous cards and tells the user the requested selection failed`, async ({ page }) => {
    await seed(page)
    await page.route('**/api/web/rigs/rig-1/target-discovery?*', route => route.fulfill({ status, json: { error: 'Unavailable' } }))
    await page.goto('/rigs/rig-1/observe/targets')
    await page.getByRole('button', { name: 'Emission nebulae', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText(status === 410 ? 'no longer available on the server' : 'Could not load these targets')
    await expect(page.getByText('The cards below still show your previous selection.')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  })
}

test('returning to the saved selection cancels a pending page without leaving Refresh disabled', async ({ page }) => {
  await seed(page)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let requested = false
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', async route => {
    requested = true
    await gate
    await route.fulfill({ json: response(new URL(route.request().url())) }).catch(() => {})
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await page.getByRole('button', { name: 'Galaxies', exact: true }).click()
  await expect.poll(() => requested).toBe(true)
  await expect(page.getByRole('button', { name: 'Loading…', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'All objects', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Refresh', exact: true })).toBeEnabled()
  release()
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'All objects', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
