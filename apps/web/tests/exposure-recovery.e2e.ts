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
  subject: null,
  savedCount: 0,
  integrationSeconds: 0,
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
  await expect(page.locator('.vela-af-outcome')).toContainText('Waiting for the same exposure')
  await page.getByRole('button', { name: 'Stop and restore start' }).click()
  await expect.poll(() => commands).toBe(1)
  await expect(page.getByRole('button', { name: 'Stop and restore start' })).toBeDisabled()
  await expect(page.locator('.vela-af-outcome')).toContainText('Sending command…')
  await expect(page.locator('.vela-af-point')).toHaveCount(1)
  await expect(page.locator('.vela-af-readout time')).toHaveAttribute('datetime', capturedAt)
  await expect(page.getByText('Start position restored', { exact: true })).toHaveCount(0)
  await expect(page.locator('.vela-af-status-dot')).toHaveCount(0)
  await screenshot(page, 'autofocus-stop-pending', 1280)
  finishStop()
  await expect(page.locator('.vela-af-notice')).toContainText('Command outcome unknown')
  await expect(page.locator('.vela-af-outcome')).toContainText('Confirmation needed')
  const readsAfterCommand = reads
  await expect.poll(() => reads).toBeGreaterThan(readsAfterCommand)
  await expect(page.locator('.vela-af-outcome')).toContainText('Command outcome unknown')
  await expect(page.locator('.vela-af-status-dot')).toHaveCount(0)
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
  await expect(page.locator('.vela-af-outcome')).toContainText('Confirmed stop')
  await expect(page.locator('.vela-af-outcome')).not.toContainText('Confirmation needed')
  await expect(page.locator('.vela-af-outcome')).toContainText('Current position 32,842')
  await expect(page.getByText('Command outcome unknown', { exact: true })).toHaveCount(0)
  await expect(page.getByText('now', { exact: true })).toHaveCount(0)
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
    const progress = page.getByRole('region', { name: 'Capture images' })
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
    await expect(page.locator('.tonight-capture__heading')).toContainText('Camera observation interrupted')
    await expect(progress.getByRole('progressbar')).toHaveCount(0)
    await expect(progress).not.toContainText('8.0 / 30')
    await expect(progress).toContainText('Exposure 8')
    await expect(image.locator('.capture-image__heading > span')).toHaveText(/^\d{2}:\d{2}:\d{2} · 1 min ago$/)
    await expect(image.locator('.capture-image__heading > span')).toHaveAttribute('title', /^Received /)
    await expect(image.getByRole('img')).toHaveAttribute('alt', '2 second exposure from Simulator Camera')
    await expect(image).toContainText('2.35')
    await expect(page.getByRole('button', { name: 'Stop capture', exact: true })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toHaveCount(0)
    const navigation = page.locator('.vela-navigation')
    await expect(navigation.locator('.vela-navigation__activity')).toHaveCount(0)
    await expect(navigation.locator('progress')).toHaveCount(0)
    await screenshot(page, 'capture', width)
    await page.goto('/rigs/rig-1/observe')
    await expect(navigation).toContainText('Awaiting camera')
    const preparation = page.getByRole('region', { name: 'Prepare a capture' })
    await expect(preparation.getByRole('form', { name: 'Capture settings' })).toContainText('Camera observation interrupted')
    await expect(navigation).toContainText('7 captured')
    await expect(preparation.getByRole('region', { name: 'Last test exposure' })).toContainText('No test exposure yet')
    await expect(preparation.getByRole('img')).toHaveCount(0)
    expect(commands).toEqual([])
    await screenshot(page, 'observe', width)
    await page.getByRole('link', { name: 'Open active capture →', exact: true }).click()
    await expect(page.locator('.tonight-capture__heading')).toContainText('Camera observation interrupted')
    await expect(progress).toContainText('Exposure 8')
    await expect(image.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(image.getByRole('img')).toHaveAttribute('alt', '2 second exposure from Simulator Camera')
    await expect(image.locator('.capture-image__heading > span')).toHaveText(/^\d{2}:\d{2}:\d{2} · 1 min ago$/)
    expect(commands).toEqual([])
    offline = true
    await expect(page.locator('.capture-page__warning')).toContainText('Connection interrupted')
    await expect(page.getByRole('button', { name: 'Stop capture', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Capture state unknown' })).toBeVisible()
    offline = false
    state = { ...state, captureReadState: 'current', phase: 'reading' }
    await expect(progress).toContainText('Receiving image')
    await expect(page.locator('.capture-page__warning')).toHaveCount(0)
    await expect(progress).toContainText('Exposure 8')
    await expect(image.getByRole('img')).toHaveAttribute('src', imageUrl)
    await expect(progress).not.toContainText('Image received')
    state = { ...state, captureReadState: 'retrying' }
    await expect(page.locator('.tonight-capture__heading')).toContainText('Camera observation interrupted')
    await page.getByRole('button', { name: 'Stop capture', exact: true }).click()
    await expect(page.locator('.capture-page__warning')).toContainText('Command outcome unknown')
    await expect(page.locator('.tonight-capture__heading')).toContainText('Command outcome unknown')
    await expect(progress.getByRole('progressbar')).toHaveCount(0)
    state = {
      ...state,
      captureReadState: 'current',
      active: false,
      phase: 'failed',
      error: 'Camera stop could not be confirmed. Check the camera before starting another run.',
    }
    await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeDisabled()
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
      constellation: 'Andromeda',
      kind: 'Galaxy',
      raDegrees: 10.6847,
      decDegrees: 41.269,
      sizeArcminutes: 178,
      minorSizeArcminutes: 63,
      thumbnailUrl: '/api/targets/m31/thumbnail',
      sky: null,
    }

    let state: FramingView = {
      preview: null,
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
    await page.getByText('Framing details & state', { exact: true }).click()
    const measurementTime = page.locator('p').filter({ hasText: /^Test exposure / })
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
    await expect(page.locator('.vela-af-status')).toContainText('Exposing at')
    await expect(page.locator('.vela-af-status')).toContainText('33,042')
    const sample = page.locator('.vela-af-point')
    const position = await sample.getAttribute('cx')
    state = { ...state, captureReadState: 'retrying' }
    await expect(page.locator('.vela-af-notice')).toContainText(
      'Waiting for the same exposure',
    )
    await expect(page.locator('.vela-af-outcome')).toContainText('Waiting for the same exposure')
    await expect(page.locator('.vela-af-status-dot')).toHaveCount(0)
    await expect(sample).toHaveCount(1)
    await expect(sample).toHaveAttribute('cx', position!)
    await expect(page.locator('.vela-af-readout')).toContainText('33,042 · 5.10 px')
    await expect(page.locator('.vela-af-readout time')).toHaveAttribute('datetime', capturedAt)
    await expect(page.getByRole('button', { name: 'Stop and restore start' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Start autofocus' })).toHaveCount(0)
    await screenshot(page, 'autofocus', width)
    offline = true
    await expect(page.locator('.vela-af-outcome')).toContainText('Autofocus state is unknown')
    await expect(page.getByRole('button', { name: 'Stop and restore start' })).toBeDisabled()
    offline = false
    state = { ...state, captureReadState: 'current', activity: 'measuring' }
    await expect(page.locator('.vela-af-status')).toContainText('Measuring star HFR')
    await expect(page.locator('.vela-af-notice')).toHaveCount(0)
    await expect(sample).toHaveCount(1)
    state = { ...state, captureReadState: 'retrying', activity: 'exposing' }
    await expect(page.locator('.vela-af-outcome')).toContainText('Waiting for the same exposure')
    await page.getByRole('button', { name: 'Stop and restore start' }).click()
    await expect(page.locator('.vela-af-status')).toContainText('Restoring start 32842')
    state = {
      ...state,
      phase: 'failed',
      active: false,
      activity: 'idle',
      error:
        'The focuser did not confirm return to the start position. Vela did not repeat the move.',
    }
    await expect(page.locator('.vela-af-notice')).toContainText('Start position not confirmed')
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
        fitImageUrl: imageUrl,
        frameId: imageUrl,
        fitImageScale: 1,
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
    await expect(page.locator('.vela-polar-activity')).toContainText('8.0 / 20 seconds')
    await expect(page.locator('.vela-polar-activity__spinner')).toBeVisible()

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
    await expect(page.locator('.vela-polar-activity')).toContainText(
      'Device connection interrupted · Retrying…',
    )
    expect(commands).toEqual([])
    await expect(page.locator('.vela-polar-activity')).not.toContainText(' / 20 seconds')
    await expect(page.locator('.vela-polar-activity__spinner')).toBeHidden()
    await expect(baseline).toHaveAttribute('src', imageUrl)
    await page.getByRole('button', { name: 'Enlarge image', exact: true }).click()
    await expect(page.getByRole('dialog').locator('time')).toHaveAttribute('datetime', capturedAt)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('list', { name: 'Three measurement positions' })).toContainText(
      'Position 1Solved',
    )
    await expect(page.getByRole('button', { name: 'Stop measurement' })).toBeEnabled()
    await screenshot(page, 'alignment-baseline', width)
    state = { ...state, activity: 'solving', warning: null }
    await expect(page.locator('.vela-polar-activity')).toContainText('Plate-solving')
    await page.getByRole('button', { name: 'Enlarge image', exact: true }).click()
    await expect(page.getByRole('dialog').locator('time')).toHaveAttribute('datetime', capturedAt)
    await page.keyboard.press('Escape')
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
        solvedAt: '2026-09-21T01:00:30Z',
        targetX: 310,
        targetY: 190,
        imageWidth: 1600,
        imageHeight: 1200,
        fieldHeightDegrees: 1,
        imageUrl,
        fitImageUrl: imageUrl,
        frameId: imageUrl,
        fitImageScale: 1,
      },
    }
    await expect(page.locator('.vela-polar-total')).toContainText('14″')
    await expect(
      page.getByText('Baseline retained. Wait for a fresh measurement before adjusting.'),
    ).toBeVisible()
    await expect(page.getByRole('img', { name: /alignment target/ })).toBeVisible()
    await expect(page.locator('.vela-polar-status-dot')).toHaveCount(0)
    await expect(page.locator('.vela-polar-total time')).toHaveAttribute('datetime', capturedAt)
    await expect(page.getByRole('button', { name: 'Start measurement' })).toHaveCount(0)
    await screenshot(page, 'alignment-adjustment', width)
    await page.getByRole('button', { name: 'Stop session' }).click()
    await expect(page.locator('.vela-polar-notice')).toContainText(
      'Camera stop could not be confirmed',
    )
    await expect(page.locator('.vela-polar-total')).toContainText('14″')
    expect(commands).toEqual(['stop'])
  })
}
