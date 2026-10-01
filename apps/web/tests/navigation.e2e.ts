import { expect, test } from '@playwright/test'
import type { NavigationView } from '@vela/model/web'
import { reviewCapture } from './fixtures/fieldroom/tonight'

const initial: NavigationView = {
  rigs: [
    { id: 'rig-1', name: 'Askar FRA 400' },
    { id: 'rig-2', name: 'Seestar S30' },
  ],
  captures: [
    {
      rigId: 'rig-1',
      rigName: 'Askar FRA 400',
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

for (const width of [1440, 390]) {
  test(`navigation preserves capture identity and target query at ${width}px`, async ({ page }) => {
    const writes: string[] = []
    page.on('request', request => {
      if (request.method() !== 'GET') writes.push(request.url())
    })
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/**', route =>
      route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
    )
    await page.route('**/api/web/navigation', route => route.fulfill({ json: initial }))
    await page.goto('/rigs/rig-1/observe/targets?q=M31&offset=24')
    const bar = page.locator('.vela-navigation')
    await expect(bar.getByLabel('Viewing rig')).toHaveValue('rig-1')
    await expect(bar.locator('progress')).toHaveAttribute('value', '18')
    await bar.getByRole('link', { name: 'Tonight', exact: true }).click()
    await bar.getByRole('link', { name: 'Explore the sky', exact: true }).click()
    await expect(page).toHaveURL(/targets\?q=M31&offset=24$/)
    await bar.getByLabel('Viewing rig').selectOption('rig-2')
    await expect(page).toHaveURL(/rigs\/rig-2\/observe\/capture$/)
    const activity = bar.getByRole('link', { name: /Askar FRA 400. 17 captured/ })
    await expect(activity).toContainText('Askar FRA 400')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await activity.click()
    await expect(page).toHaveURL(/rigs\/rig-1\/observe\/capture$/)
    await bar.getByRole('link', { name: 'Vela · all rigs' }).click()
    await expect(bar.getByRole('navigation').getByRole('link')).toHaveCount(1)
    await expect(bar.getByRole('link', { name: 'Explore the sky', exact: true })).toHaveAttribute('href', '/explore')
    await expect(bar.getByRole('link', { name: 'Tonight', exact: true })).toHaveCount(0)
    await expect(activity).toBeVisible()
    await bar.screenshot({ path: `/tmp/vela-app-navigation-${width}.png` })
    expect(writes).toEqual([])
  })
}

test('activity reports loss, readout and confirmed end without inventing completion', async ({
  page,
}) => {
  await page.clock.install()
  let view = structuredClone(initial)
  let unavailable = false
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  )
  await page.route('**/api/web/navigation', route =>
    unavailable ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: view }),
  )
  await page.goto('/rigs/rig-1/observe')
  const bar = page.locator('.vela-navigation')
  await expect(bar.locator('progress')).toHaveAttribute('value', '18')
  unavailable = true
  await page.clock.fastForward(2000)
  await expect(bar.getByRole('link', { name: /Last known count/ })).toBeVisible()
  await expect(bar.locator('progress')).toHaveCount(0)
  unavailable = false
  view.captures[0]!.phase = 'reading'
  await page.clock.fastForward(2000)
  await expect(bar.getByRole('link', { name: /17 captured. Reading image/ })).toBeVisible()
  await expect(bar.locator('progress')).toHaveCount(0)
  view.captures = []
  await page.clock.fastForward(2000)
  await expect(bar.getByRole('link', { name: /Tracking lost/ })).toBeVisible()
  view = structuredClone(initial)
  view.captures[0]!.phase = 'stopped'
  view.captures[0]!.active = false
  await page.clock.fastForward(2000)
  await expect(bar.locator('.vela-navigation__activity')).toHaveCount(0)
})


test('preparation opens the confirmed active capture without starting another operation', async ({ page }) => {
  const writes: string[] = []
  const capture = { ...reviewCapture, rigId: 'rig-1', subject: null, latestImage: null }
  page.on('request', request => {
    if (request.method() !== 'GET') writes.push(request.url())
  })
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  )
  await page.route('**/api/web/navigation', route => route.fulfill({ json: initial }))
  await page.route('**/api/web/rigs/rig-1/capture', route => route.fulfill({ json: capture }))
  await page.goto('/rigs/rig-1/observe')
  await expect(page.getByRole('region', { name: 'Last test exposure' })).toContainText('No test exposure yet')
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Open active capture →', exact: true }).click()
  await expect(page).toHaveURL(/rigs\/rig-1\/observe\/capture$/)
  await expect(page.getByRole('button', { name: 'Stop capture', exact: true })).toBeEnabled()
  expect(writes).toEqual([])
})
