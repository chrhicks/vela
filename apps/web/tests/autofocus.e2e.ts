import { expect, test } from '@playwright/test'
import type { AutofocusView } from '@vela/model/web'

const setup: AutofocusView = {
  rigId: 'rig-1', rigName: 'Askar FRA 400', enabled: true, unavailableReason: null,
  cameraName: 'ASI2600MM Pro', focuserName: 'EAF', phase: 'setup', activity: 'idle', active: false,
  startPosition: null, currentPosition: 32842, maxStep: 60000, stepSize: 50, offsetSteps: 4,
  exposureSeconds: 2, elapsedSeconds: 0, exposureStartedAt: null, samples: [], fit: null,
  restoredStart: false, error: null,
}

test('setup starts from the current EAF position and never offers a home to 0', async ({ page }) => {
  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: setup }))
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByRole('heading', { name: 'Autofocus' })).toBeVisible()
  await expect(page.locator('.vela-af-facts')).toContainText('32842')
  await expect(page.locator('.vela-af-facts')).toContainText('60000')
  await expect(page.locator('.vela-af-facts')).toContainText('32642 → 33042')
  await expect(page.locator('.vela-af-facts')).toContainText('Off · 0 in / 0 out')
  await expect(page.getByRole('button', { name: 'Start autofocus' })).toBeEnabled()
  await expect(page.locator('.vela-autofocus')).not.toContainText('Move(0)')
})

test('the V-curve grows as each short lands', async ({ page }) => {
  let samples: AutofocusView['samples'] = []
  let phase: AutofocusView['phase'] = 'setup'
  let activity: AutofocusView['activity'] = 'idle'
  let active = false
  let startPosition: number | null = null
  let currentPosition = 32842
  let fit: AutofocusView['fit'] = null

  const view = (): AutofocusView => ({
    ...setup, phase, activity, active, startPosition, currentPosition, samples, fit,
  })

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: view() }))
  await page.route('**/api/rigs/rig-1/autofocus/start', async route => {
    startPosition = 32842
    phase = 'walking'
    active = true
    activity = 'exposing'
    currentPosition = 33042
    samples = [{ position: 33042, detectedStars: 18, hfrPixels: 5.42, capturedAt: '2026-09-17T00:00:00.000Z' }]
    await route.fulfill({ json: view() })
    setTimeout(() => {
      currentPosition = 32992
      samples = [
        ...samples,
        { position: 32992, detectedStars: 24, hfrPixels: 4.1, capturedAt: '2026-09-17T00:00:02.000Z' },
      ]
    }, 700)
  })

  await page.goto('/rigs/rig-1/observe/autofocus')
  await page.getByRole('button', { name: 'Start autofocus' }).click()
  await expect(page.locator('.vela-af-point')).toHaveCount(1)
  await expect(page.locator('.vela-af-readout')).toContainText('32842')
  await expect(page.locator('.vela-af-readout')).toContainText('33042 · 5.42 px')
  await expect(page.locator('.vela-af-readout')).toContainText('Fitted focus')
  await expect(page.locator('.vela-af-point')).toHaveCount(2, { timeout: 4000 })
  await expect(page.locator('.vela-af-readout')).toContainText('32992 · 4.10 px')
})

test('a window that would approach 0 does not start', async ({ page }) => {
  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({
    json: { ...setup, currentPosition: 80 },
  }))
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByRole('button', { name: 'Window does not fit' })).toBeDisabled()
  await expect(page.getByText('Walk would approach a travel limit')).toBeVisible()
})

test('a travel-limit start result is shown instead of a disconnect', async ({ page }) => {
  const failed: AutofocusView = {
    ...setup,
    phase: 'failed',
    activity: 'idle',
    active: false,
    startPosition: 0,
    currentPosition: 0,
    error: 'The focuser is already at a mechanical limit. Autofocus starts from the current position and will not command 0 or MaxStep.',
  }
  let current: AutofocusView = setup

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: current }))
  await page.route('**/api/rigs/rig-1/autofocus/start', route => {
    current = failed

    return route.fulfill({ json: failed })
  })
  await page.goto('/rigs/rig-1/observe/autofocus')
  await page.getByRole('button', { name: 'Start autofocus' }).click()
  await expect(page.getByText('Walk would approach a travel limit')).toBeVisible()
  await expect(page.getByText(/will not command 0 or MaxStep/)).toBeVisible()
  await expect(page.locator('.vela-autofocus')).not.toContainText('Disconnected')
  await expect(page.locator('.vela-af-readout')).toContainText('0')
})

test('an unrestored failure is not labeled as a travel limit', async ({ page }) => {
  const failed: AutofocusView = {
    ...setup,
    phase: 'failed',
    activity: 'idle',
    active: false,
    startPosition: 32842,
    currentPosition: 32992,
    restoredStart: false,
    error: 'The focuser did not confirm return to the start position. Vela did not repeat the move.',
  }

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: failed }))
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByText('Start position was not restored')).toBeVisible()
  await expect(page.getByText('Walk failed · start was not restored')).toBeVisible()
  await expect(page.locator('.vela-autofocus')).not.toContainText('Walk would approach a travel limit')
  await expect(page.locator('.vela-autofocus')).not.toContainText('Disconnected')
})
