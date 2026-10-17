import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import {
  createTonightScene,
  referenceImage,
  reviewCapture,
  reviewRig,
  reviewTarget,
  reviewTime,
  reviewTimezone,
  subject,
} from './fixtures/fieldroom/tonight'

const reference = readFileSync(new URL(`../../../${referenceImage.path}`, import.meta.url))

test.use({ timezoneId: reviewTimezone })

for (const width of [1440, 390]) {
  for (const sceneName of ['tonight-light', 'tonight-dark'] as const) {
    test(`${sceneName} shows confirmed capture, subject and observed equipment at ${width}px`, async ({
      page,
    }) => {
      const scene = createTonightScene(sceneName)
      await page.setViewportSize({ width, height: width === 390 ? 782 : 900 })
      await page.clock.setFixedTime(new Date(reviewTime))
      await page.addInitScript(
        (mode) => localStorage.setItem('vela.appearance', mode),
        scene.appearance,
      )
      await page.route('**/api/**', (route) => {
        const response = scene.respond(
          route.request().method(),
          new URL(route.request().url()).pathname,
        )

        return response.image
          ? route.fulfill({ contentType: 'image/jpeg', body: reference })
          : route.fulfill({ status: response.status, json: response.json })
      })
      await page.goto(scene.route)
      await expect(page.getByRole('heading', { name: 'The Crescent Nebula' })).toBeVisible()
      await expect(page.locator('.tonight-subject')).toContainText(
        'NGC 6888 · Emission nebula · Cygnus',
      )
      await expect(page.locator('.tonight-capture')).toContainText(
        '12 saved · 36 min collected',
      )
      await expect(page.locator('.tonight-capture')).toContainText('01:24')
      await expect(page.locator('.tonight-sky')).toContainText('68°')
      await expect(page.locator('.tonight-sky')).toContainText('Mount tracking')
      await expect(page.locator('.tonight-before')).toContainText('Focuser 32,842')
      await expect(page.locator('.capture-image__window img')).toBeVisible()
      await page.evaluate(() => document.fonts.ready)

      const geometry = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        card: document.querySelector('.tonight-capture')!.getBoundingClientRect().toJSON(),
        image: document.querySelector('.capture-image')!.getBoundingClientRect().toJSON(),
      }))

      expect(geometry.overflow).toBe(false)

      if (width === 1440) {
        expect(geometry.image.x).toBe(36)
        expect(geometry.image.y).toBe(124)
        expect(geometry.image.width).toBeCloseTo(912, 0)
        expect(geometry.card.width).toBeCloseTo(420, 0)
        expect(geometry.card.height).toBe(214)
      }

      expect(createHash('sha256').update(reference).digest('hex')).toBe(referenceImage.sha256)
      await page.screenshot({ path: `/tmp/vela-${sceneName}-${width}.png`, fullPage: true })

      // The open control is part of the whole-route reference, and changing it
      // must keep the decoded exposure and page geometry intact.
      const pixels = page.locator('.capture-image__window img')
      await pixels.evaluate(element => element.setAttribute('data-kept-exposure', 'yes'))
      const imageUrl = await pixels.getAttribute('src')
      await page.getByRole('button', { name: 'Appearance', exact: true }).click()
      await page.emulateMedia({ colorScheme: 'light' })
      const preference = sceneName === 'tonight-light' ? 'System' : 'Dark'
      const appearance = page.getByRole('dialog', { name: 'Appearance', exact: true })
      await expect(appearance).toBeVisible()
      await appearance.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished)))
      await page.getByRole('radio', { name: new RegExp(`^${preference}`) }).check()
      const panel = await appearance.boundingBox()
      expect(panel?.width).toBe(width === 390 ? 350 : 360)
      expect(panel!.x).toBeGreaterThanOrEqual(20)
      expect(panel!.x + panel!.width).toBeLessThanOrEqual(width - 20)
      await expect(pixels).toHaveAttribute('data-kept-exposure', 'yes')
      await expect(pixels).toHaveAttribute('src', imageUrl!)
      expect(await page.locator('.capture-image').boundingBox()).toEqual({
        x: geometry.image.x, y: geometry.image.y,
        width: geometry.image.width, height: geometry.image.height,
      })
      await page.screenshot({ path: `/tmp/vela-${sceneName}-appearance-${width}.png`, fullPage: true })
      await page.getByRole('radio', { name: sceneName === 'tonight-light' ? 'Dark' : 'Light', exact: true }).check()
      await expect(pixels).toHaveAttribute('data-kept-exposure', 'yes')
      await expect(pixels).toHaveAttribute('src', imageUrl!)
      await page.keyboard.press('Escape')
      await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeFocused()
    })
  }
}

for (const sceneName of [
  'tonight-interrupted',
  'tonight-camera-retry',
  'tonight-save-failed',
  'tonight-preview-failed',
] as const) {
  test(`${sceneName} keeps operation and image failures distinct`, async ({ page }) => {
    const scene = createTonightScene(sceneName)
    await page.setViewportSize({ width: 1440, height: 965 })
    await page.clock.setFixedTime(new Date(reviewTime))
    await page.route('**/api/**', (route) => {
      const response = scene.respond(
        route.request().method(),
        new URL(route.request().url()).pathname,
      )

      return response.image
        ? route.fulfill({ contentType: 'image/jpeg', body: reference })
        : route.fulfill({ status: response.status, json: response.json })
    })
    await page.goto(scene.route)

    if (sceneName === 'tonight-preview-failed') {
      await expect(page.getByRole('button', { name: 'Stop capture' })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'Retry image' })).toBeVisible()
      await expect(page.getByRole('progressbar', { name: 'Exposure progress' })).toBeVisible()
    } else {
      await expect(page.locator('.capture-page__warning')).toBeVisible()
      await expect(page.getByRole('progressbar', { name: 'Exposure progress' })).toHaveCount(0)
      await expect(page.locator('.capture-image__window img')).toBeVisible()
    }

    if (sceneName === 'tonight-camera-retry')
      await expect(page.getByRole('button', { name: 'Stop capture' })).toBeEnabled()

    if (sceneName === 'tonight-interrupted') {
      await expect(page.getByRole('button', { name: 'Stop capture' })).toHaveCount(0)
      const image = await page.locator('.capture-image').boundingBox()
      expect(image?.x).toBe(36)
      expect(image?.y).toBe(124)
      expect(image?.height).toBeCloseTo(700.5, 0)
      await expect(page.locator('.tonight-before')).toContainText('last known')
      await page.screenshot({ path: '/tmp/vela-tonight-interrupted-1440.png', fullPage: true })
    }
  })
}

test('pending target choice cannot relabel an active run and theme changes preserve capture inputs', async ({
  page,
}) => {
  let active = true
  const starts: unknown[] = []
  const scene = createTonightScene('tonight-light')
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname

    if (pathname.endsWith('/capture/start')) {
      starts.push(route.request().postDataJSON())

      return route.fulfill({ json: reviewCapture })
    }

    if (pathname.endsWith('/capture'))
      return route.fulfill({
        json: {
          ...reviewCapture,
          active,
          phase: active ? 'exposing' : 'stopped',
          chosenTarget: {
            state: 'chosen',
            subject: { targetId: 'next', name: 'Next subject', catalog: 'NGC 7000' },
          },
        },
      })

    if (pathname.endsWith('/targets/next'))
      return route.fulfill({ json: { ...reviewTarget, id: 'next', name: 'Next subject' } })
    const response = scene.respond(route.request().method(), pathname)

    return response.image
      ? route.fulfill({ contentType: 'image/jpeg', body: reference })
      : route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(scene.route)
  await expect(page.getByRole('heading', { name: 'The Crescent Nebula' })).toBeVisible()
  await expect(page.locator('.tonight-subject')).toContainText(
    'Another target is selected for the next run',
  )
  await expect(page.getByRole('note')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Capture without a target' })).toBeDisabled()
  active = false
  await expect(page.getByRole('heading', { name: 'Next subject' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Capture without a target' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toHaveAttribute('data-tone', 'accent')
  await expect(page.getByRole('link', { name: 'Change target', exact: true })).toHaveAttribute(
    'href',
    '/rigs/fra400/observe/targets',
  )
  await expect(page.getByRole('note')).toHaveText(
    'Mount pointing isn’t checkedFrames will be recorded as Next subject. Frame it first to slew and check.',
  )
  await expect(page.getByRole('link', { name: 'Frame it first' })).toHaveAttribute(
    'href',
    '/rigs/fra400/observe/targets/next',
  )
  await page.getByRole('spinbutton', { name: 'Exposure · seconds' }).fill('42')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('radio', { name: 'Dark', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toHaveValue('42')
  await page.getByRole('button', { name: 'Take exposure' }).click()
  await expect
    .poll(() => starts)
    .toEqual([{ exposureSeconds: 42, repeat: true, saveFrames: true, targetId: 'next' }])
})

test('with no chosen target Tonight captures at the current position without a subject', async ({
  page,
}) => {
  const starts: unknown[] = []
  const scene = createTonightScene('tonight-light')
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname

    if (pathname.endsWith('/capture/start')) {
      starts.push(route.request().postDataJSON())

      return route.fulfill({ json: reviewCapture })
    }

    if (pathname.endsWith('/capture'))
      return route.fulfill({
        json: { ...reviewCapture, active: false, phase: 'stopped', chosenTarget: { state: 'none' } },
      })
    const response = scene.respond(route.request().method(), pathname)

    return response.image
      ? route.fulfill({ contentType: 'image/jpeg', body: reference })
      : route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(scene.route)

  await expect(page.getByRole('heading', { name: 'What are we imaging tonight?' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Choose a target →' })).toHaveAttribute(
    'href',
    '/rigs/fra400/observe/targets',
  )
  await expect(page.getByRole('listitem').and(page.locator('[aria-current="step"]'))).toContainText('TargetChoose')
  await expect(page.getByRole('note')).toHaveCount(0)
  await expect(page.locator('.tonight-sky')).toHaveCount(0)
  await page.getByRole('button', { name: 'or capture at the current position' }).click()
  await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Take exposure' })).toHaveAttribute('data-tone', 'neutral')
  await page.getByRole('button', { name: 'Take exposure' }).click()
  await expect
    .poll(() => starts)
    .toEqual([{ exposureSeconds: 180, repeat: true, saveFrames: true, targetId: null }])
})


test('Capture without a target clears the chosen target and leaves Take exposure secondary', async ({
  page,
}) => {
  const choices: unknown[] = []
  let chosen = true
  const scene = createTonightScene('tonight-light')

  const view = () => ({
    ...reviewCapture,
    active: false,
    phase: 'stopped',
    subject: null,
    chosenTarget: chosen ? { state: 'chosen', subject } : { state: 'none' },
  })

  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname

    if (pathname.endsWith('/capture/target')) {
      choices.push({ method: route.request().method(), body: route.request().postDataJSON() })
      chosen = false

      return route.fulfill({ json: view() })
    }

    if (pathname.endsWith('/capture')) return route.fulfill({ json: view() })
    const response = scene.respond(route.request().method(), pathname)

    return response.image
      ? route.fulfill({ contentType: 'image/jpeg', body: reference })
      : route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(scene.route)
  await expect(page.getByRole('heading', { name: 'The Crescent Nebula' })).toBeVisible()
  await expect(page.getByRole('listitem').and(page.locator('[aria-current="step"]'))).toContainText('CaptureNow')
  await page.getByRole('button', { name: 'Capture without a target' }).click()
  await expect(page.getByRole('heading', { name: 'What are we imaging tonight?' })).toBeVisible()
  expect(choices).toEqual([{ method: 'PUT', body: { targetId: null } }])
  await expect(page.getByRole('button', { name: 'Take exposure' })).toHaveAttribute('data-tone', 'neutral')
})

test('Tonight uses capture-camera cooling and current sky direction instead of inventory order or future samples', async ({ page }) => {
  const scene = createTonightScene('tonight-light')
  let coolingAvailable = true
  await page.route('**/api/**', (route) => {
    const pathname = new URL(route.request().url()).pathname

    if (pathname === '/api/web/rigs/fra400')
      return route.fulfill({ json: {
        ...reviewRig,
        devices: [{
          ...reviewRig.devices[0],
          id: 'guide-camera',
          configuredName: 'Guide camera',
          name: 'Guide camera',
          status: {
            availability: 'complete',
            activity: 'idle',
            sensorTemperatureC: 25,
            cooling: { state: 'off' },
          },
        }, ...reviewRig.devices],
        connections: { total: 4, connected: 4, disconnected: 0, unavailable: 0 },
      } })

    if (pathname.endsWith('/capture'))
      return route.fulfill({ json: { ...reviewCapture, cooling: coolingAvailable ? reviewCapture.cooling : null } })

    if (pathname.endsWith('/targets/ngc6888'))
      return route.fulfill({ json: {
        ...reviewTarget,
        sky: { ...reviewTarget.sky!, currentAzimuthDegrees: 5.5,
          observedAt: '2026-09-29T18:00:00.000Z',
          samples: reviewTarget.sky!.samples.map(sample => ({ ...sample, azimuthDegrees: 45 })),
        },
      } })
    const response = scene.respond(route.request().method(), pathname)

    return response.image
      ? route.fulfill({ contentType: 'image/jpeg', body: reference })
      : route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(scene.route)
  await expect(page.locator('.tonight-before')).toContainText('Cooler on, sensor -10.0°C')
  await expect(page.locator('.tonight-before')).not.toContainText('25.0°C')
  await expect(page.locator('.tonight-sky')).toContainText('Northern sky')
  await expect(page.locator('.tonight-sky')).not.toContainText('Northeastern')
  coolingAvailable = false
  await expect(page.locator('.tonight-before')).toContainText('Cooling unavailable')
  await expect(page.locator('.tonight-before')).not.toContainText('25.0°C')
})
