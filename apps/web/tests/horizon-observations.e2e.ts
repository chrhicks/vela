import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { HomeView, HorizonObservationView, NavigationView, RigDetailView } from '@vela/model/web'

test.use({ locale: 'en-GB', timezoneId: 'UTC' })

const navigation: NavigationView = { rigs: [{ id: 'rig-1', name: 'Backyard rig' }], captures: [] }

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
  endpoint: { host: 'rig.example', port: 11111 },
  addedAt: new Date().toISOString(),
  lastInventoryAt: new Date().toISOString(),
  refreshedAt: new Date().toISOString(),
  connections: { total: 0, connected: 0, disconnected: 0, unavailable: 0 },
  devices: [],
  capabilities: [],
}

const tree: HorizonObservationView = {
  id: 'tree',
  at: '2026-01-02T03:12:00.000Z',
  altitudeDegrees: 25.4,
  azimuthDegrees: 100.2,
  strongBefore: 48,
  strongAt: 2,
  runId: 'run-1',
}

const cloud: HorizonObservationView = { ...tree, id: 'cloud', at: '2026-01-01T02:00:00.000Z', altitudeDegrees: 60, azimuthDegrees: 200, strongBefore: 30, strongAt: 0 }

async function useRig(page: Page, observations: HorizonObservationView[], deletes: string[] = []) {
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.route('**/api/web/navigation', route => route.fulfill({ json: navigation }))
  await page.route('**/api/web/home', route => route.fulfill({ json: home }))
  await page.route('**/api/web/rigs/rig-1', route => route.fulfill({ json: detail }))

  await page.route('**/api/web/rigs/rig-1/horizon-observations', route =>
    route.fulfill({ json: { rigId: 'rig-1', observations } }),
  )

  await page.route('**/api/rigs/rig-1/horizon-observations/*', route => {
    const id = route.request().url().split('/').at(-1)!

    deletes.push(id)
    observations = observations.filter(observation => observation.id !== id)

    return route.fulfill({ status: 204 })
  })
}

test('the rig page lists where stars dropped out and deletes a wrong one, a cloud and not a tree', async ({ page }) => {
  const deletes: string[] = []

  await useRig(page, [tree, cloud], deletes)
  await page.goto('/rigs/rig-1')

  const section = page.getByRole('region', { name: 'Star dropouts' })
  const rows = section.getByRole('listitem')

  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toContainText('azimuth 100° · altitude 25°')
  await expect(rows.first()).toContainText('48 strong stars before, 2 at the drop')
  await expect(rows.last()).toContainText('azimuth 200° · altitude 60°')

  await rows.last().getByRole('button', { name: /^Delete/ }).click()

  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('azimuth 100°')
  expect(deletes).toEqual(['cloud'])
})

test('with none recorded it says so, and when the list cannot be read it says that', async ({ page }) => {
  await useRig(page, [])
  await page.goto('/rigs/rig-1')
  await expect(page.getByRole('region', { name: 'Star dropouts' })).toContainText('None recorded yet.')

  await page.route('**/api/web/rigs/rig-1/horizon-observations', route => route.fulfill({ status: 503, json: { error: 'down' } }))
  await page.reload()
  await expect(page.getByRole('region', { name: 'Star dropouts' })).toContainText('Star dropouts could not be read.')
})

test('a delete the server refuses keeps the row and says so', async ({ page }) => {
  await useRig(page, [tree])
  await page.route('**/api/rigs/rig-1/horizon-observations/*', route => route.fulfill({ status: 409, json: { error: 'observations-unusable' } }))
  await page.goto('/rigs/rig-1')

  const section = page.getByRole('region', { name: 'Star dropouts' })

  await section.getByRole('button', { name: /^Delete/ }).click()
  await expect(section.getByRole('alert')).toContainText('could not be deleted')
  await expect(section.getByRole('listitem')).toHaveCount(1)
})
