import { expect, test } from '@playwright/test'
import type { CaptureView } from '@vela/model/web'

const idle: CaptureView = {
  captureReadState: 'current',
  rigId: 'rig-1',
  rigName: 'Cooling review',
  camera: { name: 'Main camera' },
  enabled: true,
  unavailableReason: null,
  phase: 'idle',
  active: false,
  exposureSeconds: 2,
  elapsedSeconds: 0,
  error: null,
  saveFrames: false,
  savedImageCount: 0,
  latestImage: null,
  repeat: false,
  completedCount: 0,
  cooling: {
    state: 'off',
    canSetTemperature: true,
    setpointC: 5,
    sensorTemperatureC: 5,
  },
}

test.beforeEach(async ({ page }) => {
  await page.route('**/api/web/navigation', route =>
    route.fulfill({ json: { rigs: [], captures: [] } }),
  )
})

test('keeps uncertain temperature visible through incomplete reads and capture commands until the setting is observed', async ({
  page,
}) => {
  let current = idle
  let commands = 0
  let reads = 0
  await page.route('**/api/web/rigs/rig-1/capture', route => {
    reads++

    return route.fulfill({ json: current })
  })
  await page.route('**/api/rigs/rig-1/capture/cooling', route => {
    commands++
    current = { ...idle, cooling: { state: 'off', canSetTemperature: true } }

    return route.fulfill({
      status: 409,
      json: {
        error:
          'The cooler command could not be confirmed. Check camera cooling before assuming it changed.',
      },
    })
  })
  await page.route('**/api/rigs/rig-1/capture/start', route => {
    current = { ...current, active: true, phase: 'exposing' }

    return route.fulfill({ json: current })
  })
  await page.route('**/api/rigs/rig-1/capture/stop', route => {
    current = { ...current, active: false, phase: 'stopped' }

    return route.fulfill({ json: current })
  })
  await page.goto('/rigs/rig-1/observe/capture')
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  const check = cooling.getByRole('button', { name: 'Check camera cooling' })
  const warning = cooling.getByText('Cooler command outcome unknown.', { exact: false })
  await cooling.getByRole('spinbutton').fill('-5')
  await cooling.getByRole('button', { name: 'Set temperature' }).click()
  await expect(warning).toBeVisible()
  await expect(cooling.getByRole('button', { name: 'Set temperature' })).toBeDisabled()
  const beforeRead = reads
  await check.click()
  await expect.poll(() => reads).toBeGreaterThan(beforeRead)
  await expect(check).toBeEnabled()
  await expect(warning).toBeVisible()
  await expect(cooling.getByRole('button', { name: 'Set temperature' })).toBeDisabled()

  await page.getByRole('button', { name: 'Take exposure' }).click()
  await expect(page.getByRole('button', { name: 'Stop exposure' })).toBeEnabled()
  await expect(warning).toBeVisible()
  await expect(check).toBeDisabled()
  await page.getByRole('button', { name: 'Stop exposure' }).click()
  await expect(check).toBeEnabled()
  await expect(warning).toBeVisible()

  current = { ...current, cooling: null }
  await check.click()
  await expect(cooling.getByText('Cooling state is unavailable.', { exact: false })).toBeVisible()
  await expect(warning).toBeVisible()
  await expect(check).toBeEnabled()

  current = { ...current, cooling: { state: 'off', canSetTemperature: true, setpointC: -3 } }
  await check.click()
  await expect(warning).toHaveCount(0)
  await expect(check).toHaveCount(0)
  await expect(cooling.getByRole('button', { name: 'Set temperature' })).toBeEnabled()
  await expect(cooling.locator('dl')).toContainText('-3.0 °C')
  expect(commands).toBe(1)
})

test('resolves an uncertain cooler switch from its fresh state without requiring a temperature setpoint', async ({
  page,
}) => {
  let current = idle
  await page.route('**/api/web/rigs/rig-1/capture', route => route.fulfill({ json: current }))
  await page.route('**/api/rigs/rig-1/capture/cooling', route => {
    current = { ...idle, cooling: { state: 'on', canSetTemperature: false } }

    return route.abort()
  })
  await page.goto('/rigs/rig-1/observe/capture')
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  await cooling.getByText('Cooler on', { exact: true }).click()
  await expect(cooling.getByText('Cooler command outcome unknown.', { exact: false })).toBeVisible()
  await cooling.getByRole('button', { name: 'Check camera cooling' }).click()
  await expect(cooling.getByRole('button', { name: 'Check camera cooling' })).toHaveCount(0)
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeChecked()
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeEnabled()
})
