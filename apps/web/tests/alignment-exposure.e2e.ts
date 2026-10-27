import { expect, test, type Page } from '@playwright/test'
import type { AlignmentView } from '@vela/model/web'

function setupView(overrides: Partial<AlignmentView> = {}): AlignmentView {
  return {
    mode: 'physical',
    cameraName: 'ASI2600MC Pro',
    rigId: 'rig-1',
    rigName: 'Askar FRA 400',
    enabled: true,
    unavailableReason: null,
    phase: 'setup',
    activity: 'idle',
    active: false,
    position: 0,
    solvedPositions: 0,
    exposureSeconds: 2,
    exposureStartedAt: null,
    measuredAt: null,
    warning: null,
    error: null,
    measurement: null,
    ...overrides,
  }
}

/** Serves `view`, and answers Start by activating it with the exposure the page sent. */
async function serve(page: Page, view: AlignmentView) {
  const starts: unknown[] = []
  let release: (() => void) | undefined
  let hold = false

  await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: view }))

  await page.route('**/api/rigs/rig-1/alignment/start', async route => {
    const body: { exposureSeconds?: number } = route.request().postDataJSON()
    starts.push(body)

    if (hold) await new Promise<void>(resolve => (release = resolve))
    Object.assign(view, {
      phase: 'baseline',
      active: true,
      activity: 'homing',
      position: 1,
      exposureSeconds: body.exposureSeconds ?? view.exposureSeconds,
    })
    await route.fulfill({ json: view })
  })

  return {
    starts,
    holdStart: () => {
      hold = true
    },
    releaseStart: () => release?.(),
  }
}

const exposure = (page: Page) => page.getByRole('group', { name: 'Exposure in seconds' })

test('a run starts at 2 seconds unless another preset is chosen', async ({ page }) => {
  const view = setupView()
  const server = await serve(page, view)
  await page.goto('/rigs/rig-1/observe/alignment')
  await expect(exposure(page).getByRole('button', { name: '2 s' })).toHaveAttribute('aria-pressed', 'true')
  await expect(exposure(page).getByRole('button')).toHaveText(['1 s', '2 s', '3 s', '5 s', '10 s'])
  await page.getByRole('button', { name: 'Start measurement' }).click()
  await expect(page.getByText('Exposure: 2 seconds')).toBeVisible()
  expect(server.starts).toEqual([{ exposureSeconds: 2 }])
})

test('the chosen exposure is sent, locked while Start is pending and shown as plain text during the run', async ({
  page,
}) => {
  const view = setupView()
  const server = await serve(page, view)
  server.holdStart()
  await page.goto('/rigs/rig-1/observe/alignment')
  await exposure(page).getByRole('button', { name: '5 s' }).click()
  await expect(exposure(page).getByRole('button', { name: '5 s' })).toHaveAttribute('aria-pressed', 'true')
  await expect(exposure(page).getByRole('button', { name: '2 s' })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Start measurement' }).click()
  await expect.poll(() => server.starts).toEqual([{ exposureSeconds: 5 }])

  for (const seconds of ['1 s', '2 s', '3 s', '5 s', '10 s'])
    await expect(exposure(page).getByRole('button', { name: seconds })).toBeDisabled()
  server.releaseStart()
  await expect(page.getByText('Exposure: 5 seconds')).toBeVisible()
  await expect(page.getByRole('group', { name: 'Exposure in seconds' })).toHaveCount(0)
})

test('Measure again offers the exposure and sends the new choice', async ({ page }) => {
  const view = setupView({
    phase: 'stopped',
    exposureSeconds: 5,
    measuredAt: new Date().toISOString(),
    solvedPositions: 3,
    measurement: {
      altitudeArcsec: 9,
      azimuthArcsec: 11,
      totalArcsec: 14,
      solvedAt: '2026-10-26T01:00:30Z',
      imageUrl: '/api/alignment-fixture.png',
      fitImageUrl: '/api/alignment-fixture.png',
      frameId: 'frame-1',
      fitImageScale: 1,
      imageWidth: 640,
      imageHeight: 400,
      targetX: 310,
      targetY: 190,
      fieldHeightDegrees: 1,
    },
  })

  const server = await serve(page, view)
  await page.goto('/rigs/rig-1/observe/alignment')
  await exposure(page).getByRole('button', { name: '10 s' }).click()
  await page.getByRole('button', { name: 'Measure again' }).click()
  await expect.poll(() => server.starts).toEqual([{ exposureSeconds: 10 }])
})
