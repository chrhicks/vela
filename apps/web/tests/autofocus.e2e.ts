import { expect, test } from '@playwright/test'
import type { AutofocusView } from '@vela/model/web'

const setup: AutofocusView = {
  captureReadState: 'current',
  rigId: 'rig-1',
  rigName: 'Askar FRA 400',
  enabled: true,
  unavailableReason: null,
  cameraName: 'ASI2600MM Pro',
  focuserName: 'EAF',
  phase: 'setup',
  activity: 'idle',
  active: false,
  startPosition: null,
  currentPosition: 32842,
  maxStep: 60000,
  stepSize: 50,
  offsetSteps: 4,
  exposureSeconds: 2,
  elapsedSeconds: 0,
  exposureStartedAt: null,
  samples: [],
  fit: null,
  restoredStart: false,
  error: null,
}

test('setup starts from the current EAF position and never offers a home to 0', async ({
  page,
}) => {
  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: setup }))
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByRole('heading', { name: 'Autofocus' })).toBeVisible()
  await expect(page.locator('.vela-af-window--desktop')).toContainText('32,842')
  await expect(page.locator('.vela-af-facts')).toContainText('60,000')
  await expect(page.locator('.vela-af-window-facts')).toContainText('32,642 – 33,042')
  await expect(page.getByRole('button', { name: 'Start autofocus' })).toBeEnabled()
  await expect(page.locator('.vela-af-facts')).not.toContainText('0 in / 0 out')
  await expect(page.locator('.vela-autofocus')).not.toContainText('Move(0)')
  await expect(page.locator('.vela-autofocus')).toContainText('not backlash compensation off')
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
    ...setup,
    phase,
    activity,
    active,
    startPosition,
    currentPosition,
    samples,
    fit,
  })

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: view() }))
  await page.route('**/api/rigs/rig-1/autofocus/start', async route => {
    startPosition = 32842
    phase = 'walking'
    active = true
    activity = 'exposing'
    currentPosition = 33042
    samples = [
      {
        position: 33042,
        detectedStars: 18,
        hfrPixels: 5.42,
        capturedAt: '2026-09-17T00:00:00.000Z',
      },
    ]
    await route.fulfill({ json: view() })
    setTimeout(() => {
      currentPosition = 32992
      samples = [
        ...samples,
        {
          position: 32992,
          detectedStars: 24,
          hfrPixels: 4.1,
          capturedAt: '2026-09-17T00:00:02.000Z',
        },
      ]
    }, 700)
  })

  await page.goto('/rigs/rig-1/observe/autofocus')
  await page.getByRole('button', { name: 'Start autofocus' }).click()
  await expect(page.locator('.vela-af-point')).toHaveCount(1)
  await expect(page.locator('.vela-af-readout')).toContainText('32,842')
  await expect(page.locator('.vela-af-readout')).toContainText('33,042 · 5.42 px')
  await expect(page.locator('.vela-af-readout')).toContainText('Fitted focus')
  await expect(page.locator('.vela-af-point')).toHaveCount(2, { timeout: 4000 })
  await expect(page.locator('.vela-af-readout')).toContainText('32,992 · 4.10 px')
})

test('a window that would approach 0 does not start', async ({ page }) => {
  await page.route('**/api/web/rigs/rig-1/autofocus', route =>
    route.fulfill({
      json: { ...setup, currentPosition: 80 },
    }),
  )
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByRole('button', { name: 'Window does not fit' })).toBeDisabled()
  await expect(page.getByRole('heading', { name: 'Window does not fit' })).toBeVisible()
  await expect(page.locator('.vela-af-window-facts')).toContainText('Does not fit around start')
})

test('a travel-limit start result returns to setup instead of a disconnect', async ({ page }) => {
  const aborted: AutofocusView = {
    ...setup,
    currentPosition: 0,
    error:
      'The focuser is already at a mechanical limit. Autofocus starts from the current position and will not command 0 or MaxStep.',
  }

  let current: AutofocusView = setup

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: current }))
  await page.route('**/api/rigs/rig-1/autofocus/start', route => {
    current = aborted

    return route.fulfill({ json: aborted })
  })
  await page.goto('/rigs/rig-1/observe/autofocus')
  await page.getByRole('button', { name: 'Start autofocus' }).click()
  await expect(page.getByRole('heading', { name: 'Window does not fit' })).toBeVisible()
  await expect(page.locator('.vela-af-notice')).toContainText('will not command 0 or MaxStep')
  await expect(page.locator('.vela-autofocus')).not.toContainText('Disconnected')
  await expect(page.locator('.vela-autofocus')).not.toContainText('Start position was not restored')
  await expect(page.locator('.vela-autofocus')).not.toContainText('Focus again')
  await expect(page.locator('.vela-autofocus')).not.toContainText(
    'Points appear as each short lands',
  )
  await expect(page.locator('.vela-af-facts')).toContainText('0')
  await expect(page.getByLabel('Step size')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Window does not fit' })).toBeDisabled()
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
    samples: [
      {
        position: 32992,
        detectedStars: 18,
        hfrPixels: 4.1,
        capturedAt: '2026-09-17T00:00:02.000Z',
      },
    ],
    error:
      'The focuser did not confirm return to the start position. Vela did not repeat the move.',
  }

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: failed }))
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByText('Start position not confirmed')).toBeVisible()
  await expect(page.getByText('Restoration failed', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to setup' })).toBeVisible()
  await expect(page.locator('.vela-autofocus')).not.toContainText(
    'Walk would approach a travel limit',
  )
  await expect(page.locator('.vela-autofocus')).not.toContainText('Disconnected')
  await expect(page.locator('.vela-autofocus')).not.toContainText(
    'Points appear as each short lands',
  )
  await page.getByRole('button', { name: 'Back to setup' }).click()
  await expect(page.getByLabel('Step size')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start autofocus' })).toBeVisible()
  await expect(page.getByText('Start position not confirmed')).toBeVisible()
})

test('a restored stop keeps the walk view and notice, then returns to setup', async ({ page }) => {
  const stopped: AutofocusView = {
    ...setup,
    phase: 'stopped',
    activity: 'idle',
    active: false,
    startPosition: 32842,
    currentPosition: 32842,
    restoredStart: true,
    samples: [
      {
        position: 32942,
        detectedStars: 22,
        hfrPixels: 3.21,
        capturedAt: '2026-09-17T00:00:04.000Z',
      },
    ],
  }

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: stopped }))
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByText('Start position restored')).toBeVisible()
  await expect(page.locator('.vela-af-notice')).toContainText('back at 32,842')
  await expect(page.locator('.vela-af-point')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Back to setup' })).toBeVisible()
  await page.getByRole('button', { name: 'Back to setup' }).click()
  await expect(page.getByLabel('Step size')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start autofocus' })).toBeVisible()
  await expect(page.locator('.vela-autofocus')).not.toContainText('Start position restored')
})

test('focus again returns to setup instead of starting another walk', async ({ page }) => {
  const complete: AutofocusView = {
    ...setup,
    phase: 'complete',
    activity: 'idle',
    active: false,
    startPosition: 32842,
    currentPosition: 32838,
    samples: [
      {
        position: 32642,
        detectedStars: 40,
        hfrPixels: 5.06,
        capturedAt: '2026-09-17T00:00:10.000Z',
      },
    ],
    fit: {
      position: 32838,
      p: 32838.2,
      a: 2.18,
      b: 95,
      rSquared: 0.99,
      minSamplePosition: 32842,
    },
  }

  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: complete }))
  await page.route('**/api/rigs/rig-1/autofocus/start', route =>
    route.fulfill({ status: 500, json: { error: 'should not start' } }),
  )
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.getByText('Fitted focus is ready')).toBeVisible()
  await expect(page.locator('.vela-af-readout')).toContainText('32,838')
  await page.getByRole('button', { name: 'Focus again' }).click()
  await expect(page.getByLabel('Step size')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start autofocus' })).toBeVisible()
  await expect(page.locator('.vela-autofocus')).not.toContainText('should not start')
})

test('an unknown Stop stays blocked through active reads until a terminal result is confirmed', async ({ page }) => {
  let stops = 0
  let readsAfterStop = 0

  let current: AutofocusView = {
    ...setup,
    phase: 'walking',
    activity: 'exposing',
    active: true,
    startPosition: 32842,
    currentPosition: 32992,
    samples: [{ position: 33042, detectedStars: 18, hfrPixels: 5.1, capturedAt: '2026-09-17T00:00:00.000Z' }],
  }

  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unrelated fixture request' } }))
  await page.route('**/api/web/rigs/rig-1/autofocus', route => {
    if (stops) readsAfterStop++

    return route.fulfill({ json: current })
  })
  await page.route('**/api/rigs/rig-1/autofocus/stop', route => {
    stops++

    return route.abort('failed')
  })
  await page.goto('/rigs/rig-1/observe/autofocus')
  const stop = page.getByRole('button', { name: 'Stop and restore start', exact: true })
  await stop.click()
  await expect(page.getByText('Command outcome unknown', { exact: true }).first()).toBeVisible()
  await expect.poll(() => readsAfterStop).toBeGreaterThanOrEqual(2)
  expect(stops).toBe(1)
  await expect(page.locator('.vela-af-point')).toHaveCount(1)
  await expect(stop).toBeDisabled()

  current = { ...current, phase: 'stopped', activity: 'idle', active: false, currentPosition: 32842, restoredStart: true }
  await expect(page.getByText('Start position restored', { exact: true })).toBeVisible()
  await expect(page.getByText('Command outcome unknown', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to setup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Start autofocus', exact: true })).toBeEnabled()
  expect(stops).toBe(1)
})

test('the autofocus hook itself blocks repeated Stop calls until terminal reconciliation', async ({ page }) => {
  let stops = 0
  let starts = 0

  let current: AutofocusView = {
    ...setup,
    phase: 'walking',
    activity: 'exposing',
    active: true,
    startPosition: 32842,
    currentPosition: 32992,
  }

  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unrelated fixture request' } }))
  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: current }))
  await page.route('**/api/rigs/rig-1/autofocus/stop', route => {
    stops++

    return route.abort('failed')
  })
  await page.route('**/api/rigs/rig-1/autofocus/start', route => {
    starts++

    return route.fulfill({ json: { ...current, phase: 'walking', active: true, activity: 'moving' } })
  })
  await page.goto('/')
  await page.evaluate(async () => {
    const path = '/tests/autofocus-hook-harness.tsx'
    const harness = await import(path)
    harness.mountAutofocusHook()
  })
  await expect.poll(() => page.evaluate(async () => {
    const path = '/tests/autofocus-hook-harness.tsx'
    const harness = await import(path)

    return harness.getAutofocusHook().view?.active
  })).toBe(true)

  // Call the same captured callback twice: no button can suppress the second call.
  await page.evaluate(async () => {
    const path = '/tests/autofocus-hook-harness.tsx'
    const harness = await import(path)
    const controller = harness.getAutofocusHook()
    await controller.stop()
    await controller.stop()
    await controller.start(50, 2)
  })
  expect(stops).toBe(1)
  expect(starts).toBe(0)
  await expect.poll(() => page.evaluate(async () => {
    const path = '/tests/autofocus-hook-harness.tsx'
    const harness = await import(path)
    const controller = harness.getAutofocusHook()

    return { pending: controller.pending, unconfirmed: controller.stopUnconfirmed }
  })).toEqual({ pending: false, unconfirmed: true })

  current = { ...current, phase: 'stopped', active: false, activity: 'idle', currentPosition: 32842, restoredStart: true }
  await expect.poll(() => page.evaluate(async () => {
    const path = '/tests/autofocus-hook-harness.tsx'
    const harness = await import(path)
    const controller = harness.getAutofocusHook()

    return { phase: controller.view?.phase, unconfirmed: controller.stopUnconfirmed, error: controller.error }
  })).toEqual({ phase: 'stopped', unconfirmed: false, error: null })
  await page.evaluate(async () => {
    const path = '/tests/autofocus-hook-harness.tsx'
    const harness = await import(path)
    await harness.getAutofocusHook().start(50, 2)
    harness.unmountAutofocusHook()
  })
  expect(stops).toBe(1)
  expect(starts).toBe(1)
})

test('a lost Start response can still be stopped after the active walk is observed', async ({ page }) => {
  let starts = 0
  let stops = 0
  let current = setup
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unrelated fixture request' } }))
  await page.route('**/api/web/rigs/rig-1/autofocus', route => route.fulfill({ json: current }))
  await page.route('**/api/rigs/rig-1/autofocus/start', route => {
    starts++
    current = { ...setup, phase: 'walking', activity: 'moving', active: true, startPosition: 32842 }

    return route.abort('failed')
  })
  await page.route('**/api/rigs/rig-1/autofocus/stop', route => {
    stops++
    current = { ...current, phase: 'stopped', activity: 'idle', active: false, restoredStart: true }

    return route.fulfill({ json: current })
  })
  await page.goto('/rigs/rig-1/observe/autofocus')
  await page.getByRole('button', { name: 'Start autofocus', exact: true }).click()
  await expect(page.getByText('Command outcome unknown', { exact: true }).first()).toBeVisible()
  const stop = page.getByRole('button', { name: 'Stop and restore start', exact: true })
  await expect(stop).toBeEnabled()
  await stop.click()
  await expect(page.getByText('Start position restored', { exact: true })).toBeVisible()
  expect(starts).toBe(1)
  expect(stops).toBe(1)
})
