import { expect, test, type Page } from '@playwright/test'
import type {
  AlignmentView,
  AutofocusView,
  CaptureView,
  FramingView,
  TargetView,
} from '@vela/model/web'
import { readFileSync } from 'node:fs'
import { observation } from './fixtures/observation'

const capturedAt = '2026-09-21T01:00:00.000Z'

const imageUrl = '/api/rigs/rig-1/capture/images/retained'

const preview = readFileSync(
  new URL('../../../packages/ui/src/components/fixtures/capture-star-field.png', import.meta.url),
)

const capture: CaptureView = {
  rigId: 'rig-1',
  rigName: 'Recovery simulator',
  camera: { name: 'Simulator Camera' },
  enabled: true,
  unavailableReason: null,
  phase: 'exposing',
  active: true,
  captureReadState: 'current',
  exposureSeconds: 30,
  elapsedSeconds: 8,
  repeat: true,
  completedCount: 7,
  saveFrames: false,
  savedImageCount: 0,
  error: null,
  cooling: null,
  latestImage: {
    id: 'retained',
    saved: false,
    imageUrl,
    width: 1600,
    height: 1200,
    exposureSeconds: 2,
    capturedAt,
    receivedAt: '2026-09-21T01:00:03.000Z',
    cameraName: 'Simulator Camera',
    color: 'mono',
    statistics: { detectedStars: 12, medianHfrPixels: 2.35 },
  },
}

const autofocus: AutofocusView = {
  rigId: 'rig-1',
  rigName: 'Recovery simulator',
  enabled: true,
  unavailableReason: null,
  cameraName: 'Simulator Camera',
  focuserName: 'Simulator Focuser',
  phase: 'walking',
  activity: 'exposing',
  active: true,
  captureReadState: 'current',
  startPosition: 32842,
  currentPosition: 33042,
  maxStep: 60000,
  stepSize: 50,
  offsetSteps: 4,
  exposureSeconds: 2,
  elapsedSeconds: 0.4,
  exposureStartedAt: capturedAt,
  samples: [{ position: 33042, detectedStars: 12, hfrPixels: 5.1, capturedAt }],
  fit: null,
  restoredStart: false,
  error: null,
}

test.beforeEach(async ({ page }) => {
  // Every API request stays in this explicit fixture boundary, including shell reads.
  await page.route('**/api/**', route =>
    route.fulfill({ status: 503, json: { error: 'No fixture for this request' } }),
  )
  await page.route('**/api/web/navigation', route =>
    route.fulfill({ json: { rigs: [], captures: [] } }),
  )
  await page.route(`**${imageUrl}`, route =>
    route.fulfill({ contentType: 'image/png', body: preview }),
  )
})

async function screenshot(page: Page, name: string, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const path = test.info().outputPath(`exposure-recovery-${name}-${width}.png`)
  await page.screenshot({ path, fullPage: true })
  await test.info().attach(name, { path, contentType: 'image/png' })
}

test('an uncertain autofocus Stop retains priority until polling confirms restoration', async ({
  page,
}) => {
  let state: AutofocusView = { ...autofocus, captureReadState: 'retrying' }
  let commands = 0
  let reads = 0
  let finishStop!: () => void

  const stopResponse = new Promise<void>(resolve => {
    finishStop = resolve
  })

  await page.route('**/api/web/rigs/rig-1/autofocus', route => {
    reads++

    return route.fulfill({ json: state })
  })
  await page.route('**/api/rigs/rig-1/autofocus/stop', async route => {
    commands++
    await stopResponse

    return route.abort('connectionreset')
  })
  await page.goto('/rigs/rig-1/observe/autofocus')
  await expect(page.locator('.vela-af-heading')).toContainText('Awaiting camera')
  await page.getByRole('button', { name: 'Stop and restore start' }).click()
  await expect.poll(() => commands).toBe(1)
  await expect(page.getByRole('button', { name: 'Stop and restore start' })).toBeDisabled()
  await expect(page.locator('.vela-af-activity')).toContainText('Sending command')
  await expect(page.locator('.vela-af-activity__spinner')).toHaveCount(0)
  finishStop()
  await expect(page.locator('.vela-af-notice')).toContainText('Command outcome unknown')
  await expect(page.locator('.vela-af-heading')).toContainText('Confirmation needed')
  const readsAfterCommand = reads
  await expect.poll(() => reads).toBeGreaterThan(readsAfterCommand)
  await expect(page.locator('.vela-af-activity')).toContainText('Command outcome unknown')
  await expect(page.locator('.vela-af-activity__spinner')).toHaveCount(0)
  await expect(page.getByText('now', { exact: true })).toHaveCount(0)
  await expect(page.locator('.vela-af-readout time')).toHaveAttribute('datetime', capturedAt)
  state = {
    ...state,
    active: false,
    phase: 'stopped',
    activity: 'idle',
    captureReadState: 'current',
    currentPosition: state.startPosition,
    restoredStart: true,
  }
  await expect(page.locator('.vela-af-notice')).toContainText('Start position restored')
  await expect(page.locator('.vela-af-heading')).toContainText('Restored')
  await expect(page.locator('.vela-af-heading')).not.toContainText('Confirmation needed')
  await expect(page.locator('.vela-af-activity')).toContainText('Walk stopped · start restored')
  await expect(page.getByText('Command outcome unknown', { exact: true })).toHaveCount(0)
  await expect(page.getByText('now', { exact: true })).toBeVisible()
  expect(commands).toBe(1)
})

for (const width of [1280, 390]) {
  test(`capture read recovery retains image/count across navigation and Stop uncertainty at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.clock.setFixedTime(new Date('2026-09-21T01:01:03.000Z'))
    let state = structuredClone(capture)
    let offline = false
    const commands: string[] = []
    await page.route('**/api/web/rigs/rig-1/capture', route =>
      offline ? route.abort() : route.fulfill({ json: state }),
    )
    await page.route('**/api/web/navigation', route =>
      offline
        ? route.abort()
        : route.fulfill({
            json: {
              rigs: [{ id: state.rigId, name: state.rigName }],
              captures: [state],
            },
          }),
    )
    await page.route('**/api/web/rigs/rig-1/observe', route =>
      route.fulfill({ json: observation('complete') }),
    )
    await page.route('**/api/rigs/rig-1/capture/*', route => {
      commands.push(route.request().url().split('/').at(-1)!)

      return route.abort('connectionreset')
    })
    await page.goto('/rigs/rig-1/observe/capture')
    const progress = page.locator('.capture-page__progress')
    const image = page.getByRole('region', { name: 'Latest image', exact: true })
    await expect(progress.getByRole('progressbar')).toBeVisible()
    await expect(image.getByRole('img')).toHaveAttribute('src', imageUrl)
    state = { ...state, captureReadState: 'retrying' }
    await expect(page.locator('.capture-page__warning')).toContainText(
      'Camera observation interrupted',
    )
    await expect(page.locator('.capture-page__warning')).toContainText(
      'Retrying reads for exposure 8',
    )
    await expect(page.locator('.capture-page__heading')).toContainText('Awaiting camera')
    await expect(progress.getByRole('progressbar')).toHaveCount(0)
    await expect(progress).not.toContainText('8.0 / 30')
    await expect(page.locator('.capture-page__count')).toHaveText('7images completed')
    await expect(image).toContainText('1 min ago · Previous exposure')
    await expect(image).toContainText('2.35')
    await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Start run', exact: true })).toHaveCount(0)
    const navigation = page.locator('.vela-navigation')
    await expect(navigation).toContainText('Awaiting camera')
    await expect(navigation.locator('progress')).toHaveCount(0)
    await screenshot(page, 'capture', width)
    await page.getByRole('link', { name: '← Observe', exact: true }).click()
    const hub = page.locator('.vela-capture-entry').first()
    await expect(hub).toContainText('Retrying reads for the same exposure')
    await expect(hub).toContainText('7 completed')
    await expect(hub).toContainText('2 s · 60 s ago')
    await expect(hub.getByRole('img')).toHaveAttribute('src', imageUrl)
    await screenshot(page, 'observe', width)
    await page.getByRole('link', { name: 'View capture' }).click()
    await expect(page.locator('.capture-page__heading')).toContainText('Awaiting camera')
    offline = true
    await expect(page.locator('.capture-page__warning')).toContainText('Connection interrupted')
    await expect(page.getByRole('button', { name: 'Stop run', exact: true })).toBeDisabled()
    await expect(navigation).toContainText('Updates lost')
    offline = false
    state = { ...state, captureReadState: 'current', phase: 'reading' }
    await expect(progress).toContainText('Receiving image')
    await expect(page.locator('.capture-page__warning')).toHaveCount(0)
    await expect(page.locator('.capture-page__count')).toHaveText('7images completed')
    await expect(image.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(progress).not.toContainText('Image received')
    state = { ...state, captureReadState: 'retrying' }
    await expect(page.locator('.capture-page__heading')).toContainText('Awaiting camera')
    await page.getByRole('button', { name: 'Stop run', exact: true }).click()
    await expect(page.locator('.capture-page__warning')).toContainText('Command outcome unknown')
    await expect(page.locator('.capture-page__heading')).toContainText('Confirmation needed')
    await expect(progress.getByRole('progressbar')).toHaveCount(0)
    state = {
      ...state,
      captureReadState: 'current',
      active: false,
      phase: 'failed',
      error: 'Camera stop could not be confirmed. Check the camera before starting another run.',
    }
    await expect(page.getByRole('button', { name: 'Start run', exact: true })).toBeDisabled()
    await expect(image.getByRole('img')).toHaveAttribute('src', imageUrl)
    await page.getByRole('button', { name: 'Check capture state', exact: true }).click()
    await expect(page.locator('.capture-page__warning')).toContainText(
      'Camera stop could not be confirmed',
    )
    expect(commands).toEqual(['stop'])
  })

  test(`framing retries keep the solved footprint/history and resume without claiming centered at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.clock.setFixedTime(new Date(capturedAt))

    const target: TargetView = {
      id: 'm31',
      name: 'Andromeda Galaxy',
      catalog: 'M31',
      kind: 'Galaxy',
      raDegrees: 10.6847,
      decDegrees: 41.269,
      sizeArcminutes: 178,
      thumbnailUrl: '/api/targets/m31/thumbnail',
      sky: null,
    }

    let state: FramingView = {
      rigId: 'rig-1',
      rigName: 'Recovery simulator',
      enabled: true,
      unavailableReason: null,
      observedAt: capturedAt,
      phase: 'downloading',
      active: true,
      captureReadState: 'current',
      focalLengthMm: 400,
      exposureSeconds: 20,
      camera: {
        name: 'Simulator Camera',
        width: 3000,
        height: 2000,
        fieldWidthDegrees: 3,
        fieldHeightDegrees: 2,
      },
      desired: target,
      targetId: target.id,
      error: null,
      canCenter: false,
      checkCurrent: false,
      pointingSide: 'east',
      actual: {
        ...target,
        checkId: 'last-check',
        capturedAt,
        rotationDegrees: 32,
        offsetArcminutes: 2.4,
        corners: [
          { raDegrees: 9, decDegrees: 40 },
          { raDegrees: 11, decDegrees: 40 },
          { raDegrees: 11, decDegrees: 42 },
          { raDegrees: 9, decDegrees: 42 },
        ],
      },
      centering: {
        correction: 1,
        maxCorrections: 4,
        toleranceArcminutes: 0.5,
        outcome: 'working',
        measurements: [
          {
            correction: 0,
            checkId: 'last-check',
            capturedAt,
            rotationDegrees: 32,
            offsetArcminutes: 2.4,
            pointingSide: 'east',
            pointingSideChanged: false,
            trend: 'starting',
          },
        ],
      },
    }

    let offline = false
    const commands: string[] = []
    await page.route('**/api/web/rigs/rig-1/targets/m31', route => route.fulfill({ json: target }))
    await page.route('**/api/survey/dss2/**', route =>
      route.request().url().endsWith('/properties')
        ? route.fulfill({
            contentType: 'text/plain',
            body: 'dataproduct_type=image\nhips_order=9\nhips_tile_width=512\nhips_frame=equatorial\nhips_tile_format=jpeg\n',
          })
        : route.fulfill({
            contentType: 'image/jpeg',
            body: readFileSync(
              new URL(
                route.request().url().endsWith('Allsky.jpg')
                  ? './fixtures/survey-allsky.jpg'
                  : './fixtures/survey-tile.jpg',
                import.meta.url,
              ),
            ),
          }),
    )
    await page.route('**/api/web/rigs/rig-1/framing', route =>
      offline ? route.abort() : route.fulfill({ json: state }),
    )
    await page.route('**/api/rigs/rig-1/framing/*', route => {
      commands.push(route.request().url().split('/').at(-1)!)

      return route.abort('connectionreset')
    })
    await page.goto('/rigs/rig-1/observe/targets/m31')
    const status = page.locator('.vela-target-status')
    await expect(status).toContainText('Receiving the image')
    const footprint = page.locator('.vela-target-footprint--actual')
    await expect(footprint).toBeVisible({ timeout: 30000 })
    // Aladin publishes its initial projection before fitting the actual content width.
    await expect
      .poll(() =>
        footprint.evaluate(element => {
          if (!(element instanceof SVGPolygonElement) || !element.ownerSVGElement) return false
          const bounds = element.ownerSVGElement.getBoundingClientRect()

          return Array.from(element.points).every(
            point =>
              point.x >= 0 && point.x <= bounds.width && point.y >= 0 && point.y <= bounds.height,
          )
        }),
      )
      .toBe(true)
    const corners = await footprint.getAttribute('points')
    const measurementTime = page.getByText(/^Test exposure /)
    const timeText = await measurementTime.textContent()
    const history = page.getByRole('region', { name: 'Centering measurements' })
    const historyText = await history.textContent()
    state = { ...state, captureReadState: 'retrying' }
    await expect(status).toContainText('Retrying reads for the same exposure')
    await expect(page.locator('.vela-working-indicator')).toBeHidden()
    await expect(page.locator('.vela-target-offset > strong')).toHaveText('2.40′')
    await expect(measurementTime).toHaveText(timeText!)
    await expect(history).toHaveText(historyText!)
    await expect(footprint).toHaveAttribute('points', corners!)
    await expect(page.getByRole('button', { name: 'Stop framing' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Slew & check' })).toHaveCount(0)
    await expect(
      page.getByRole('button', { name: 'Check current frame', exact: true }),
    ).toHaveCount(0)
    await screenshot(page, 'framing', width)
    offline = true
    await expect(status).toContainText('Connection interrupted')
    await expect(page.getByRole('button', { name: 'Stop framing' })).toBeDisabled()
    offline = false
    state = { ...state, captureReadState: 'current', phase: 'solving' }
    await expect(status).toContainText('Measuring the new framing')
    await expect(page.locator('.vela-working-indicator')).toBeVisible()
    await expect(status).not.toContainText('Composition centered')
    await expect(measurementTime).toHaveText(timeText!)
    state = { ...state, captureReadState: 'retrying', phase: 'downloading' }
    await expect(status).toContainText('Camera observation interrupted')
    await page.getByRole('button', { name: 'Stop framing' }).click()
    await expect(status).toContainText('Check rig state before continuing')
    await expect(page.locator('.vela-working-indicator')).toBeHidden()
    await expect(history).toHaveText(historyText!)
    await expect(footprint).toHaveAttribute('points', corners!)
    expect(commands).toEqual(['stop'])
  })

  test(`autofocus keeps samples and their timestamp during read retry and uncertain cleanup at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    let state = structuredClone(autofocus)
    const commands: string[] = []
    let offline = false
    await page.route('**/api/web/rigs/rig-1/autofocus', route =>
      offline ? route.abort() : route.fulfill({ json: state }),
    )
    await page.route('**/api/rigs/rig-1/autofocus/*', route => {
      commands.push(route.request().url().split('/').at(-1)!)
      state = { ...state, captureReadState: 'current', activity: 'restoring' }

      return route.fulfill({ json: state })
    })
    await page.goto('/rigs/rig-1/observe/autofocus')
    await expect(page.locator('.vela-af-activity')).toContainText('Exposing at 33042')
    const sample = page.locator('.vela-af-point')
    const position = await sample.getAttribute('cx')
    state = { ...state, captureReadState: 'retrying' }
    await expect(page.locator('.vela-af-notice')).toContainText(
      'Retrying reads for the same exposure',
    )
    await expect(page.locator('.vela-af-heading')).toContainText('Awaiting camera')
    await expect(page.locator('.vela-af-activity__spinner')).toHaveCount(0)
    await expect(sample).toHaveCount(1)
    await expect(sample).toHaveAttribute('cx', position!)
    await expect(page.locator('.vela-af-readout')).toContainText('33042 · 5.10 px')
    await expect(page.locator('.vela-af-readout time')).toHaveAttribute('datetime', capturedAt)
    await expect(page.getByRole('button', { name: 'Stop and restore start' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Start autofocus' })).toHaveCount(0)
    await screenshot(page, 'autofocus', width)
    offline = true
    await expect(page.locator('.vela-af-heading')).toContainText('Disconnected')
    await expect(page.getByRole('button', { name: 'Stop and restore start' })).toBeDisabled()
    offline = false
    state = { ...state, captureReadState: 'current', activity: 'measuring' }
    await expect(page.locator('.vela-af-activity')).toContainText('Measuring star HFR')
    await expect(page.locator('.vela-af-notice')).toHaveCount(0)
    await expect(sample).toHaveCount(1)
    state = { ...state, captureReadState: 'retrying', activity: 'exposing' }
    await expect(page.locator('.vela-af-heading')).toContainText('Awaiting camera')
    await page.getByRole('button', { name: 'Stop and restore start' }).click()
    await expect(page.locator('.vela-af-activity')).toContainText('Restoring start 32842')
    state = {
      ...state,
      phase: 'failed',
      active: false,
      activity: 'idle',
      error:
        'The focuser did not confirm return to the start position. Vela did not repeat the move.',
    }
    await expect(page.locator('.vela-af-notice')).toContainText('Start position was not restored')
    await expect(sample).toHaveCount(1)
    await expect(page.locator('.vela-af-readout time')).toHaveAttribute('datetime', capturedAt)
    expect(commands).toEqual(['stop'])
  })

  test(`alignment pauses live feedback while retaining baseline and solved measurements at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 })
    await page.clock.setFixedTime(new Date('2026-09-21T01:00:08.000Z'))

    let state: AlignmentView = {
      rigId: 'rig-1',
      rigName: 'Recovery simulator',
      mode: 'offline',
      enabled: true,
      unavailableReason: null,
      phase: 'baseline',
      activity: 'exposing',
      active: true,
      position: 2,
      solvedPositions: 1,
      exposureSeconds: 20,
      exposureStartedAt: capturedAt,
      measuredAt: null,
      measurement: null,
      error: null,
      warning: null,
      preview: {
        imageUrl,
        imageWidth: 1600,
        imageHeight: 1200,
        capturedAt,
        position: 1,
      },
    }

    const commands: string[] = []
    await page.route('**/api/web/rigs/rig-1/alignment', route => route.fulfill({ json: state }))
    await page.route('**/api/rigs/rig-1/alignment/*', route => {
      commands.push(route.request().url().split('/').at(-1)!)
      state = {
        ...state,
        phase: 'failed',
        active: false,
        activity: 'idle',
        warning: null,
        error: 'Camera stop could not be confirmed. The command was not repeated.',
      }

      return route.fulfill({ json: state })
    })
    await page.goto('/rigs/rig-1/observe/alignment')
    await expect(page.getByRole('progressbar')).toBeVisible()

    const baseline = page.getByRole('img', {
      name: 'Latest camera exposure at baseline position 1',
    })

    await expect(baseline).toBeVisible()
    state = {
      ...state,
      activity: 'retrying',
      exposureStartedAt: null,
      warning: 'Device connection interrupted. Retrying automatically.',
    }
    await expect(page.getByRole('alert')).toContainText(
      'Any pending exposure is kept; it is not restarted while reads retry',
    )
    await expect(page.getByRole('progressbar')).toBeHidden()
    await expect(page.locator('.vela-polar-activity__spinner')).toBeHidden()
    await expect(page.locator('.vela-polar-activity__time')).toHaveCount(0)
    await expect(baseline).toHaveAttribute('src', imageUrl)
    await expect(page.locator('time')).toHaveAttribute('datetime', capturedAt)
    await expect(page.getByRole('list', { name: 'Three measurement positions' })).toContainText(
      'Position 1Solved',
    )
    await expect(page.getByRole('button', { name: 'Stop measurement' })).toBeEnabled()
    await screenshot(page, 'alignment-baseline', width)
    state = { ...state, activity: 'solving', warning: null }
    await expect(page.locator('.vela-polar-activity')).toContainText('Plate-solving')
    await expect(page.locator('time')).toHaveAttribute('datetime', capturedAt)
    state = {
      ...state,
      phase: 'adjusting',
      activity: 'retrying',
      solvedPositions: 3,
      measuredAt: capturedAt,
      warning: 'Device connection interrupted. Retrying automatically.',
      measurement: {
        altitudeArcsec: 9,
        azimuthArcsec: 11,
        totalArcsec: 14,
        targetX: 310,
        targetY: 190,
        imageWidth: 1600,
        imageHeight: 1200,
        fieldHeightDegrees: 1,
        imageUrl,
      },
    }
    await expect(page.locator('.vela-polar-total')).toContainText('14″')
    await expect(
      page.getByText(/Pause adjustments until a fresh measurement arrives/),
    ).toBeVisible()
    await expect(page.getByRole('img', { name: /alignment target/ })).toBeVisible()
    await expect(page.locator('.vela-polar-activity__spinner')).toBeHidden()
    await expect(page.getByRole('button', { name: 'Start measurement' })).toHaveCount(0)
    await screenshot(page, 'alignment-adjustment', width)
    await page.getByRole('button', { name: 'Stop to reposition' }).click()
    await expect(page.locator('.vela-polar-notice')).toContainText(
      'Camera stop could not be confirmed',
    )
    await expect(page.locator('.vela-polar-total')).toContainText('14″')
    expect(commands).toEqual(['stop'])
  })
}
