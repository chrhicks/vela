import { expect, test } from '@playwright/test'
import { openExploreScene } from './fixtures/fieldroom/browser'
import { reviewTimezone } from './fixtures/fieldroom/tonight'

test.use({ timezoneId: reviewTimezone })

test('an uncertain Take exposure stays on Tonight without command replay', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-start-uncertain')
  await page.getByRole('button', { name: 'Take exposure', exact: true }).click()
  await expect(page.getByText('The command response could not be confirmed.', { exact: false })).toBeVisible()
  await expect(page).toHaveURL(/\/observe\/capture$/)
  await page.getByRole('button', { name: 'Check capture state', exact: true }).click()
  await page.waitForTimeout(1_500)
  expect(scene.commands).toHaveLength(1)
  await expect(page.getByRole('button', { name: 'Take exposure', exact: true })).toHaveCount(0)
})

test('cooling commands remain explicit and independent from exposure settings', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-light')
  await page.getByRole('spinbutton', { name: 'Exposure · seconds' }).fill('60')
  await page.getByRole('button', { name: 'Camera cooling', exact: true }).click()
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  await cooling.getByRole('spinbutton', { name: 'Target temperature · °C' }).fill('-15')
  await cooling.getByRole('button', { name: 'Set temperature', exact: true }).click()
  await expect.poll(() => scene.commands).toHaveLength(1)
  expect(scene.commands[0]).toMatchObject({ pathname: '/api/rigs/fra400/capture/cooling', body: { setpointC: -15 } })
  await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toHaveValue('60')
  await expect(page.getByRole('button', { name: 'Take exposure', exact: true })).toBeEnabled()
  await cooling.getByText('Cooler on', { exact: true }).click()
  await expect.poll(() => scene.commands).toHaveLength(2)
  expect(scene.commands[1]).toMatchObject({ pathname: '/api/rigs/fra400/capture/cooling', body: { coolerOn: false } })
})

test('uncertain cooler state remains explicit and its check never replays a write', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-cooling-uncertain')
  await page.getByRole('button', { name: 'Camera cooling', exact: true }).click()
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  await cooling.getByText('Cooler on', { exact: true }).click()
  await expect(cooling.getByText('Cooler command outcome unknown.', { exact: false })).toBeVisible()
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeDisabled()
  expect(scene.commands).toHaveLength(1)
  expect(scene.commands[0]).toMatchObject({ pathname: '/api/rigs/fra400/capture/cooling', body: { coolerOn: false } })
})

for (const width of [1440, 1024, 390]) {
  test(`Before you shoot links preparation and recovers a disconnected rig at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { scene } = await openExploreScene(page, 'preparation-disconnected')
    const before = page.getByRole('region', { name: 'Before you shoot', exact: true })
    await expect(before.getByRole('link', { name: 'Polar alignment' })).toHaveAttribute('href', '/rigs/fra400/observe/alignment')
    await expect(before.getByRole('link', { name: 'Autofocus' })).toHaveAttribute('href', '/rigs/fra400/observe/autofocus')
    const steps = page.getByRole('list', { name: 'Tonight’s steps' })
    await expect(steps.locator('[aria-current="step"]')).toContainText('RigNeeds attention')
    const take = page.getByRole('button', { name: 'Take exposure', exact: true })
    await expect(take).toBeDisabled()
    await expect(page.getByText('The imaging camera is disconnected.', { exact: false })).toBeVisible()
    const connect = before.getByRole('button', { name: 'Connect devices', exact: true })
    await expect(connect).toHaveAttribute('type', 'button')
    await page.getByRole('spinbutton', { name: 'Exposure · seconds' }).fill('120')
    await connect.click()
    await expect(take).toBeEnabled()
    await expect(steps.locator('[aria-current="step"]')).toContainText('CaptureNow')
    await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toHaveValue('120')
    expect(scene.commands).toEqual([{ method: 'POST', pathname: '/api/rigs/fra400/connections', body: undefined }])
    expect(scene.unknownRequests).toEqual([])
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}

for (const width of [1440, 390]) {
  test(`unknown connection outcome keeps Take exposure blocked until an explicit check at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const { scene, requests } = await openExploreScene(page, 'preparation-connection-uncertain')
    const take = page.getByRole('button', { name: 'Take exposure', exact: true })
    await page.getByRole('spinbutton', { name: 'Exposure · seconds' }).fill('45')
    await page.getByRole('button', { name: 'Connect devices', exact: true }).click()
    await expect(page.getByText('The command response could not be confirmed.', { exact: false })).toBeVisible()
    await expect(take).toBeDisabled()
    await expect.poll(() => requests.filter(request => request === 'GET /api/web/rigs/fra400/observe').length, { timeout: 10_000 }).toBeGreaterThanOrEqual(3)
    await expect(take).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Connect devices', exact: true })).toHaveCount(0)
    const check = page.getByRole('region', { name: 'Rig readiness' }).getByRole('button', { name: 'Check state', exact: true })
    await expect(check).toHaveAttribute('type', 'button')
    await check.click()
    await expect(take).toBeEnabled()
    await expect(take).toBeFocused()
    await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toHaveValue('45')
    expect(scene.commands).toHaveLength(1)
    expect(scene.commands[0]).toMatchObject({ method: 'POST', pathname: '/api/rigs/fra400/connections' })
    expect(scene.unknownRequests).toEqual([])
  })
}
