import { z } from 'zod'
import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { TargetDiscoveryView } from '@vela/model/web'

const saved: TargetDiscoveryView = {
  rigId: 'rig-1',
  rigName: 'Test rig',
  snapshotId: 'night-original',
  calculatedAt: '2026-09-08T02:00:00.000Z',
  status: 'available',
  night: {
    startsAt: '2026-09-08T02:00:00.000Z',
    endsAt: '2026-09-08T09:00:00.000Z',
    kind: 'current-night',
  },
  site: { latitudeDegrees: 40, longitudeDegrees: -75 },
  siteUnavailableReason: null,
  query: '',
  category: 'all',
  filter: 'all',
  offset: 0,
  pageSize: 3,
  total: 9,
  targets: [
    {
      id: 'm31',
      name: 'Andromeda Galaxy',
      catalog: 'M31',
      constellation: null,
      kind: 'Galaxy',
      raDegrees: 10.6847,
      decDegrees: 41.269,
      sizeArcminutes: 178,
      minorSizeArcminutes: 63,
      thumbnailUrl: '/api/survey/thumbnail?ra=10&dec=41&fov=3',
      sky: null,
      category: 'galaxy',
      filterChoice: 'broadband',
      filterReason: 'Broadband preserves the galaxy’s starlight.',
      opportunity: {
        startsAt: '2026-09-08T02:00:00.000Z',
        endsAt: '2026-09-08T07:00:00.000Z',
        usefulMinutes: 300,
        bestAt: '2026-09-08T05:00:00.000Z',
        bestAltitudeDegrees: 80,
        currentAltitudeDegrees: 48,
      },
    },
  ],
}

async function seed(page: Page, value = saved) {
  await page.addInitScript(
    (value) => localStorage.setItem('vela:target-discovery:v1:rig-1', JSON.stringify(value)),
    value,
  )
  await page.route('**/api/survey/**', (route) => route.abort())
}

function response(url: URL, snapshotId = saved.snapshotId): TargetDiscoveryView {
  return {
    ...saved,
    snapshotId,
    query: url.searchParams.get('q') ?? '',
    category: z
      .enum(['all', 'emission', 'reflection-dark', 'galaxy', 'cluster', 'planetary', 'other'])
      .parse(url.searchParams.get('category') ?? 'all'),
    filter: z
      .enum(['all', 'dual-band', 'broadband', 'uncertain'])
      .parse(url.searchParams.get('filter') ?? 'all'),
    offset: Number(url.searchParams.get('offset') ?? 0),
  }
}

test('saved suggestions paint on reload without recalculating, including on a phone', async ({
  page,
}) => {
  await seed(page)
  await page.setViewportSize({ width: 390, height: 844 })
  let requests = 0
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', (route) => {
    requests++

    return route.abort()
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' }).first()).toBeVisible()
  await expect(page.getByText(/Saved suggestions/)).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeEnabled()
  expect(requests).toBe(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('type, light preference and page preserve the calculation; Refresh resets the page and gets a new one', async ({
  page,
}) => {
  await seed(page)
  const requests: URL[] = []
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    const next = response(url, url.searchParams.get('snapshot') ?? 'night-refreshed')

    return route.fulfill({ json: next })
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await page.getByRole('combobox', { name: 'Object type' }).selectOption('galaxy')
  await expect.poll(() => requests.length).toBe(1)
  await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeEnabled()
  await page.getByRole('combobox', { name: 'Imaging filter' }).selectOption('broadband')
  await expect.poll(() => requests.length).toBe(2)
  await expect(page.getByRole('button', { name: 'Next subjects →', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Next subjects →', exact: true }).click()
  await expect(page.getByLabel('Target pages')).toContainText('Page 2 of 3')
  expect(requests.map((url) => url.searchParams.get('snapshot'))).toEqual([
    'night-original',
    'night-original',
    'night-original',
  ])
  expect(requests[2]!.searchParams.get('offset')).toBe('3')
  await page.getByRole('button', { name: 'Update sky', exact: true }).click()
  await expect(page.getByLabel('Target pages')).toContainText('Page 1 of 3')
  const refresh = requests.find((url) => !url.searchParams.has('snapshot'))
  expect(refresh).toBeDefined()
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vela:target-discovery:v1:rig-1')!).snapshotId,
      ),
    )
    .toBe('night-refreshed')
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vela:target-discovery:v1:rig-1')!).offset,
      ),
    )
    .toBe(0)
  await expect(page.getByRole('button', { name: 'Next subjects →', exact: true })).toBeEnabled()
  await page.getByRole('button', { name: 'Next subjects →', exact: true }).click()
  await expect(page.getByLabel('Target pages')).toContainText('Page 2 of 3')
  expect(requests.at(-1)!.searchParams.get('snapshot')).toBe('night-refreshed')
  await expect
    .poll(() =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem('vela:target-discovery:v1:rig-1')!).offset,
      ),
    )
    .toBe(3)
})

for (const status of [503, 410]) {
  test(`${status} keeps the previous cards and tells the user the requested selection failed`, async ({
    page,
  }) => {
    await seed(page)
    await page.route('**/api/web/rigs/rig-1/target-discovery?*', (route) =>
      route.fulfill({ status, json: { error: 'Unavailable' } }),
    )
    await page.goto('/rigs/rig-1/observe/targets')
    await page.getByRole('combobox', { name: 'Object type' }).selectOption('emission')
    await expect(page.getByRole('alert')).toContainText(
      status === 410 ? 'no longer available on the server' : 'Could not load these targets',
    )
    await expect(
      page.getByText('The cards below still show your previous selection.'),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeEnabled()
  })
}

test('returning to the saved selection cancels a pending page without leaving Refresh disabled', async ({
  page,
}) => {
  await seed(page)
  let release!: () => void

  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  let requested = false
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', async (route) => {
    requested = true
    await gate
    await route.fulfill({ json: response(new URL(route.request().url())) }).catch(() => {})
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await page.getByRole('combobox', { name: 'Object type' }).selectOption('galaxy')
  await expect.poll(() => requested).toBe(true)
  await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeDisabled()
  await page.getByRole('combobox', { name: 'Object type' }).selectOption('all')
  await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeEnabled()
  release()
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' }).first()).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Object type' })).toHaveValue('all')
})

for (const width of [1280, 390]) {
  test(`page navigation moves to results but search, filters and refresh retain focus at ${width}px`, async ({
    page,
  }) => {
    await seed(page)
    await page.setViewportSize({ width, height: 844 })
    await page.route('**/api/web/rigs/rig-1/target-discovery?*', (route) =>
      route.fulfill({ json: response(new URL(route.request().url())) }),
    )
    await page.goto('/rigs/rig-1/observe/targets')
    const results = page.locator('.vela-discovery__results')
    const search = page.getByRole('searchbox', { name: 'Find a target' })
    const next = page.getByRole('button', { name: 'Next subjects →', exact: true })
    const previous = page.getByRole('button', { name: 'Previous', exact: true })
    await next.click()
    await expect(results).toBeFocused()
    await next.click()
    await expect(page.getByLabel('Target pages')).toContainText('Page 3 of 3')
    await expect(next).toBeDisabled()
    await previous.click()
    await expect(results).toBeFocused()
    await expect(page.getByLabel('Target pages')).toContainText('Page 2 of 3')

    await search.fill('M31')
    await expect(results).toContainText('Results for “M31”')
    await expect(page.getByLabel('Target pages')).toContainText('Page 1 of 3')
    await expect(search).toBeFocused()
    await expect(search).toBeInViewport()
    await search.press('End')
    await search.pressSequentially(' galaxy')
    await expect(results).toContainText('Results for “M31 galaxy”')
    await expect(search).toBeFocused()

    for (const [control, value] of [
      [page.getByRole('combobox', { name: 'Object type' }), 'galaxy'],
      [page.getByRole('combobox', { name: 'Imaging filter' }), 'broadband'],
      [page.getByRole('button', { name: 'Update sky', exact: true }), null],
    ] as const) {
      await next.click()
      await expect(page.getByLabel('Target pages')).toContainText('Page 2 of 3')

      if (value) {
        await control.focus()
        await control.selectOption(value)
      } else await control.click()
      await expect(page.getByLabel('Target pages')).toContainText('Page 1 of 3')
      await expect(results).not.toBeFocused()
      await expect(control).toBeInViewport()
    }

    await next.click()
    await expect(page.getByLabel('Target pages')).toContainText('Page 2 of 3')
    await page.goBack()
    await expect(page.getByLabel('Target pages')).toContainText('Page 1 of 3')
    await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeEnabled()
  })
}

test('a delayed page cannot steal focus after the user returns to search', async ({ page }) => {
  await seed(page)
  let release!: () => void

  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  await page.route('**/api/web/rigs/rig-1/target-discovery?*', async (route) => {
    const url = new URL(route.request().url())

    if (url.searchParams.get('offset') === '3') await gate
    await route.fulfill({ json: response(url) }).catch(() => {})
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await page.getByRole('button', { name: 'Next subjects →', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Update sky', exact: true })).toBeDisabled()
  const search = page.getByRole('searchbox', { name: 'Find a target' })
  await search.focus()
  release()
  await expect(page.getByLabel('Target pages')).toContainText('Page 2 of 3')
  await expect(search).toBeFocused()
  await search.fill('unmatched')
  await expect(page.locator('.vela-discovery__results')).toContainText('Results for “unmatched”')
  await expect(search).toBeFocused()
})

test('a twelve-card saved page is not reused for the three-card Explore presentation', async ({
  page,
}) => {
  await seed(page, { ...saved, pageSize: 12 })
  const requests: URL[] = []
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', (route) => {
    const url = new URL(route.request().url())
    requests.push(url)

    return route.fulfill({ json: response(url, 'compatible-page') })
  })
  await page.goto('/rigs/rig-1/observe/targets')
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' }).first()).toBeVisible()
  expect(requests.length).toBeGreaterThan(0)
  expect(requests.every((url) => url.searchParams.get('pageSize') === '3')).toBe(true)
  expect(requests.every((url) => !url.searchParams.has('snapshot'))).toBe(true)
})

test('view subject only selects the summary, browser history restores it, and framing has a separate link', async ({
  page,
}) => {
  const selectedPage = {
    ...saved,
    targets: [
      saved.targets[0]!,
      { ...saved.targets[0]!, id: 'm13', name: 'Hercules Cluster', catalog: 'M13' },
    ],
  }

  await seed(page, selectedPage)
  const writes: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') writes.push(request.url())
  })
  await page.goto('/rigs/rig-1/observe/targets')

  const second = page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { name: 'Hercules Cluster' }) })

  await second.getByRole('button', { name: 'View subject' }).click()
  await expect(page.getByRole('complementary', { name: 'Hercules Cluster details' })).toBeVisible()
  await expect(page).toHaveURL(/subject=m13/)
  await expect(page.getByRole('link', { name: 'Frame this subject' })).toHaveAttribute(
    'href',
    '/rigs/rig-1/observe/targets/m13?category=all&filter=all&subject=m13',
  )
  await page.goBack()
  await expect(page.getByRole('complementary', { name: 'Andromeda Galaxy details' })).toBeVisible()
  expect(writes).toEqual([])
})

test('clearing empty-result filters preserves the search term', async ({ page }) => {
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', (route) =>
    route.fulfill({
      json: { ...response(new URL(route.request().url())), targets: [], total: 0 },
    }),
  )
  await page.goto('/rigs/rig-1/observe/targets?q=Orion&category=galaxy&filter=dual-band')
  await expect(page.getByRole('heading', { name: 'No targets match these filters' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters' }).click()
  await expect(page.getByRole('searchbox', { name: 'Find a target' })).toHaveValue('Orion')
  await expect(page.getByRole('combobox', { name: 'Object type' })).toHaveValue('all')
  await expect(page.getByRole('combobox', { name: 'Imaging filter' })).toHaveValue('all')
  expect(new URL(page.url()).searchParams.get('q')).toBe('Orion')
})
