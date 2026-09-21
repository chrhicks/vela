import { expect, test } from '@playwright/test'
import type { NavigationView } from '@vela/model/web'

const initial: NavigationView = {
  rigs: [{ id: 'rig-1', name: 'Askar FRA 400' }, { id: 'rig-2', name: 'Seestar S30' }],
  captures: [{ rigId: 'rig-1', rigName: 'Askar FRA 400', phase: 'exposing', active: true, captureReadState: 'current', completedCount: 17, elapsedSeconds: 18, exposureSeconds: 60, error: null }],
}

for (const width of [1440, 390]) {
  test(`navigation preserves capture identity and target query at ${width}px`, async ({ page }) => {
    const writes: string[] = []
    page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()) })
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
    await page.route('**/api/web/navigation', route => route.fulfill({ json: initial }))
    await page.goto('/rigs/rig-1/observe/targets?q=M31&offset=24')
    const bar = page.locator('.vela-navigation')
    await expect(bar.getByLabel('Viewing rig')).toHaveValue('rig-1')
    await expect(bar.locator('progress')).toHaveAttribute('value', '18')
    await bar.getByRole('link', { name: 'Capture', exact: true }).click()
    await bar.getByRole('link', { name: 'Targets', exact: true }).click()
    await expect(page).toHaveURL(/targets\?q=M31&offset=24$/)
    await bar.getByLabel('Viewing rig').selectOption('rig-2')
    await expect(page).toHaveURL(/rigs\/rig-2\/observe$/)
    const activity = bar.getByRole('link', { name: /Askar FRA 400. 17 captured/ })
    await expect(activity).toContainText('Askar FRA 400')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await activity.click()
    await expect(page).toHaveURL(/rigs\/rig-1\/observe\/capture$/)
    await bar.getByRole('link', { name: 'Vela · all rigs' }).click()
    await expect(bar.getByRole('navigation')).toHaveCount(0)
    await expect(activity).toBeVisible()
    await bar.screenshot({ path: `/tmp/vela-app-navigation-${width}.png` })
    expect(writes).toEqual([])
  })
}

test('activity reports loss, readout and confirmed end without inventing completion', async ({ page }) => {
  await page.clock.install()
  let view = structuredClone(initial)
  let unavailable = false
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.route('**/api/web/navigation', route => unavailable ? route.fulfill({ status: 503, json: {} }) : route.fulfill({ json: view }))
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
