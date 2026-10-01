import { expect, test, type Page } from '@playwright/test'
import type { CaptureView } from '@vela/model/web'
import { readFileSync } from 'node:fs'
import {
  openEquipmentScene,
  openPhotographsScene,
} from './fixtures/fieldroom/browser'
import {
  createTonightScene,
  referenceImage,
  reviewCapture,
  reviewTime,
  reviewTimezone,
} from './fixtures/fieldroom/tonight'

const pixels = readFileSync(
  new URL(`../../../${referenceImage.path}`, import.meta.url),
)

const capturePath = '/api/web/rigs/fra400/capture'

const collectionPath = '/api/web/rigs/fra400/saved-images'

test.use({ timezoneId: reviewTimezone })

function deferred() {
  let resolve!: () => void

  const promise = new Promise<void>(done => {
    resolve = done
  })

  return { promise, resolve }
}

async function photograph(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(
      Array.from(document.images)
        .filter(image => image.complete && image.naturalWidth > 0)
        .map(image => image.decode()),
    )
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await page.screenshot({
    path: `/tmp/vela-final-${name}.png`,
    fullPage: true,
    animations: 'disabled',
  })
}

async function captureScene(page: Page, mode: 'light' | 'dark', ready = false) {
  const scene = createTonightScene(
    mode === 'light' ? 'tonight-light' : 'tonight-dark',
  )

  let view: CaptureView = structuredClone(reviewCapture)

  if (ready)
    view = {
      ...view,
      phase: 'idle',
      active: false,
      latestImage: null,
      completedCount: 0,
      savedCount: 0,
      integrationSeconds: 0,
      subject: null,
    }
  const commands: string[] = []
  const unexpected: string[] = []
  const start = deferred()
  const stop = deferred()
  await page.clock.setFixedTime(new Date(reviewTime))
  await page.addInitScript(
    value => localStorage.setItem('vela.appearance', value),
    mode,
  )
  await page.route('**/api/**', async route => {
    const request = route.request()
    const path = new URL(request.url()).pathname

    if (request.method() === 'GET' && path === capturePath)
      return route.fulfill({ json: view })

    if (request.method() === 'GET' && path === '/api/web/navigation') {
      return route.fulfill({
        json: {
          rigs: [{ id: view.rigId, name: view.rigName }],
          captures: view.active ? [view] : [],
        },
      })
    }

    if (
      request.method() === 'POST' &&
      path === '/api/rigs/fra400/capture/start'
    ) {
      commands.push('start')
      await start.promise
      view = { ...view, phase: 'exposing', active: true, elapsedSeconds: 0 }

      return route.fulfill({ json: view })
    }

    if (
      request.method() === 'POST' &&
      path === '/api/rigs/fra400/capture/stop'
    ) {
      commands.push('stop')
      await stop.promise
      view = { ...view, phase: 'stopping', active: true }

      return route.fulfill({ json: view })
    }

    const response = scene.respond(request.method(), path)

    if (response.status === 404) unexpected.push(`${request.method()} ${path}`)

    return response.image
      ? route.fulfill({ contentType: 'image/jpeg', body: pixels })
      : route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(scene.route)
  await expect(
    page.getByRole('region', { name: 'Capture images' }),
  ).toBeVisible()

  return {
    commands,
    unexpected,
    start,
    stop,
    set: (patch: Partial<CaptureView>) => {
      view = { ...view, ...patch }
    },
  }
}

for (const mode of ['light', 'dark'] as const) {
  test(`archive collection loading is distinct from an empty archive ${mode}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const { scene } = await openPhotographsScene(page, `photographs-${mode}`)
    await expect(
      page.getByRole('region', { name: 'Photograph library' }).getByRole('link'),
    ).toHaveCount(1)
    const gate = deferred()
    let requested = false
    await page.route(`**${collectionPath}`, async route => {
      requested = true
      await gate.promise
      const response = scene.respond('GET', collectionPath)
      await route.fulfill({ status: response.status, json: response.json })
    })
    await page.goto('/rigs/fra400/observe/saved-images')
    await expect.poll(() => requested).toBe(true)
    await expect(
      page.getByText('Loading photographs…', { exact: true }),
    ).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Loading saved photographs', exact: true })).toBeVisible()
    await expect(
      page.getByRole('region', { name: 'Photograph library' }).getByRole('link'),
    ).toHaveCount(0)
    await expect(
      page.getByText('No saved photographs yet', { exact: true }),
    ).toHaveCount(0)
    await photograph(page, `archive-loading-${mode}`)
    gate.resolve()
    await expect(
      page.getByText('Loading photographs…', { exact: true }),
    ).toHaveCount(0)
    await expect(
      page.getByRole('region', { name: 'Photograph library' }).getByRole('link'),
    ).toHaveCount(1)
    expect(scene.unknownRequests).toEqual([])
  })

  test(`capture publishes its first image, repeats, and waits for confirmed Stop ${mode}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const scene = await captureScene(page, mode, true)
    const operation = page.getByRole('region', { name: 'Capture images' })

    const image = page.getByRole('region', {
      name: 'Latest image',
      exact: true,
    })

    await expect(
      page.getByText('Your first image starts here', { exact: true }),
    ).toBeVisible()
    await expect(image.getByRole('img')).toHaveCount(0)
    await photograph(page, `capture-no-image-${mode}`)
    await page
      .getByRole('button', { name: 'Start capture', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Sending command…', exact: true }),
    ).toBeDisabled()
    expect(scene.commands).toEqual(['start'])
    scene.start.resolve()
    await expect(operation.getByRole('progressbar')).toBeVisible()
    await expect(
      page.getByText('Taking your first exposure', { exact: true }),
    ).toBeVisible()
    await expect(image.getByRole('img')).toHaveCount(0)
    await photograph(page, `capture-first-exposure-${mode}`)
    scene.set({ phase: 'reading' })
    await expect(operation).toContainText('Receiving image')
    await expect(operation.getByRole('progressbar')).toHaveCount(0)
    await expect(image.getByRole('img')).toHaveCount(0)
    scene.set({
      phase: 'saving',
      latestImage: reviewCapture.latestImage,
      completedCount: 1,
      savedCount: 1,
      integrationSeconds: 180,
    })
    await expect(image.getByRole('img')).toHaveAttribute(
      'src',
      reviewCapture.latestImage!.fitImageUrl!,
    )
    await expect(operation).toContainText(
      'Saving this image before the next exposure',
    )
    scene.set({ phase: 'exposing', elapsedSeconds: 1 })
    await expect(operation).toContainText('Exposure 2')
    await expect(operation.getByRole('progressbar')).toBeVisible()
    await page
      .getByRole('button', { name: 'Stop capture', exact: true })
      .click()
    await expect(
      page.getByRole('button', { name: 'Sending command…', exact: true }),
    ).toBeDisabled()
    expect(scene.commands).toEqual(['start', 'stop'])
    scene.stop.resolve()
    await expect(
      page.getByRole('button', { name: 'Stopping capture…', exact: true }),
    ).toBeDisabled()
    await expect(operation).toContainText(
      'Waiting for the camera to confirm it has stopped.',
    )
    await expect(
      page.getByRole('button', { name: 'Start capture', exact: true }),
    ).toHaveCount(0)
    await photograph(page, `capture-stopping-${mode}`)
    scene.set({ phase: 'stopped', active: false })
    await expect(
      page.getByRole('button', { name: 'Start capture', exact: true }),
    ).toBeEnabled()
    await expect(operation).toContainText('1 completed')
    await expect(image.getByRole('img')).toHaveAttribute(
      'src',
      reviewCapture.latestImage!.fitImageUrl!,
    )
    expect(scene.commands).toEqual(['start', 'stop'])
    expect(scene.unexpected).toEqual([])
  })

  test(`selected disconnected camera uses real equipment state ${mode}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 921 })

    const { scene } = await openEquipmentScene(
      page,
      'equipment-camera-disconnected',
    )

    if (mode === 'dark') {
      await page
        .getByRole('button', { name: 'Appearance', exact: true })
        .click()
      await page.getByRole('radio', { name: 'Dark', exact: true }).check()
      await page.keyboard.press('Escape')
    }

    await expect(
      page.getByRole('combobox', { name: 'Imaging camera', exact: true }),
    ).toHaveValue('camera')
    await expect(
      page
        .locator('.equipment__connection')
        .filter({ hasText: 'Disconnected' })
        .first(),
    ).toBeVisible()
    await expect(
      page.getByRole('button', { name: 'Connect devices', exact: true }),
    ).toBeEnabled()
    await page.getByRole('heading', { level: 1 }).click()
    await photograph(page, `camera-disconnected-${mode}`)
    expect(scene.writes).toEqual([])
    expect(scene.unknownRequests).toEqual([])
  })
}

test('Home Add retains its action across hover, pressed and reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { scene } = await openEquipmentScene(page, 'home-no-rigs')
  const add = page.getByRole('button', { name: 'Add a rig', exact: true })
  await expect(add).toBeVisible()

  const rest = await add.evaluate(
    element => getComputedStyle(element).backgroundColor,
  )

  await photograph(page, 'home-add-rest')
  await add.hover()
  await expect
    .poll(() =>
      add.evaluate(element => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(rest)

  const hover = await add.evaluate(
    element => getComputedStyle(element).backgroundColor,
  )

  await photograph(page, 'home-add-hover')
  await page.mouse.down()
  await expect
    .poll(() =>
      add.evaluate(element => getComputedStyle(element).backgroundColor),
    )
    .not.toBe(hover)
  await photograph(page, 'home-add-pressed')
  await page.mouse.up()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(
    await page
      .getByRole('dialog')
      .evaluate(element =>
        parseFloat(getComputedStyle(element).animationDuration),
      ),
  ).toBeLessThanOrEqual(0.01)
  await page.keyboard.press('Escape')
  await expect(add).toBeFocused()
  expect(scene.writes).toEqual([])
})

test('Capture errors remain visible across image disclosure and reduced-motion enlargement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const scene = await captureScene(page, 'light')

  const details = page.getByRole('button', {
    name: 'Image details',
    exact: true,
  })

  await expect(details).toHaveAttribute('aria-expanded', 'false')
  scene.set({
    phase: 'failed',
    active: false,
    error: 'The image could not be saved. Capture stopped.',
  })
  const error = page.locator('.capture-page__warning')
  await expect(error).toContainText('The image could not be saved.')
  await expect(error).toBeVisible()
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'true')
  await expect(error).toBeVisible()
  await details.click()
  await expect(details).toHaveAttribute('aria-expanded', 'false')
  await expect(error).toBeVisible()

  const enlarge = page.getByRole('button', {
    name: 'Enlarge image',
    exact: true,
  })

  await enlarge.click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('img')).toHaveAttribute(
    'src',
    reviewCapture.latestImage!.fitImageUrl!,
  )
  expect(
    await dialog.evaluate(element =>
      parseFloat(getComputedStyle(element).animationDuration),
    ),
  ).toBeLessThanOrEqual(0.01)
  await photograph(page, 'capture-reduced-motion-enlarged')
  await page.keyboard.press('Escape')
  await expect(enlarge).toBeFocused()
  await expect(error).toBeVisible()
  expect(scene.commands).toEqual([])
})

test.describe('touch inspection', () => {
  test.use({ hasTouch: true })
  test('native image responds to touch drag and clamps at its pixel bounds', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 782 })
    const scene = await captureScene(page, 'light')

    const image = page.getByRole('region', {
      name: 'Latest image',
      exact: true,
    })

    await image.getByRole('button', { name: '100%', exact: true }).click()
    const viewport = image.locator('.capture-image__window')
    await expect(viewport).toHaveAttribute('data-zoomed', 'true')
    const nativeSrc = await image.getByRole('img').getAttribute('src')
    const session = await page.context().newCDPSession(page)

    async function drag(from: number, to: number) {
      const box = (await viewport.boundingBox())!
      const y = box.y + Math.min(100, box.height / 2)
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchStart',
        touchPoints: [{ x: box.x + from, y }],
      })

      for (let step = 1; step <= 10; step++) {
        await session.send('Input.dispatchTouchEvent', {
          type: 'touchMove',
          touchPoints: [{ x: box.x + from + ((to - from) * step) / 10, y }],
        })
      }

      await session.send('Input.dispatchTouchEvent', {
        type: 'touchEnd',
        touchPoints: [],
      })
    }

    const before = await viewport.evaluate(element => element.scrollLeft)
    await drag(280, 40)
    await expect
      .poll(() => viewport.evaluate(element => element.scrollLeft))
      .toBeGreaterThan(before)

    for (let repeat = 0; repeat < 8; repeat++) await drag(280, 40)
    await expect
      .poll(() => viewport.evaluate(element => element.scrollLeft))
      .toBe(
        await viewport.evaluate(
          element => element.scrollWidth - element.clientWidth,
        ),
      )

    for (let repeat = 0; repeat < 8; repeat++) await drag(40, 280)
    await expect
      .poll(() => viewport.evaluate(element => element.scrollLeft))
      .toBe(0)
    await expect(image.getByRole('img')).toHaveAttribute('src', nativeSrc!)
    await photograph(page, 'capture-touch-clamped')
    expect(scene.commands).toEqual([])
    await session.detach()
  })
})
