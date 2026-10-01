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
        'NGC 6888 · Cygnus · Emission nebula',
      )
      await expect(page.locator('.tonight-capture')).toContainText(
        '12 saved · 36 min collected',
      )
      await expect(page.locator('.tonight-capture')).toContainText('01:24')
      await expect(page.locator('.tonight-sky')).toContainText('68°')
      await expect(page.locator('.tonight-sky')).toContainText('Mount tracking')
      await expect(page.locator('.tonight-equipment')).toContainText('32,842 · Idle')
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
        expect(geometry.image.y).toBe(116)
        expect(geometry.image.width).toBeCloseTo(888, 0)
        expect(geometry.card.width).toBeCloseTo(452, 0)
        expect(geometry.card.height).toBe(214)
      }

      expect(createHash('sha256').update(reference).digest('hex')).toBe(referenceImage.sha256)
      await page.screenshot({ path: `/tmp/vela-${sceneName}-${width}.png`, fullPage: true })
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
      expect(image?.y).toBe(116)
      expect(image?.height).toBe(686)
      await expect(page.locator('.tonight-equipment')).toContainText('last known')
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
        json: { ...reviewCapture, active, phase: active ? 'exposing' : 'stopped' },
      })

    if (pathname.endsWith('/targets/next'))
      return route.fulfill({ json: { ...reviewTarget, id: 'next', name: 'Next subject' } })
    const response = scene.respond(route.request().method(), pathname)

    return response.image
      ? route.fulfill({ contentType: 'image/jpeg', body: reference })
      : route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(`${scene.route}?target=next`)
  await expect(page.getByRole('heading', { name: 'The Crescent Nebula' })).toBeVisible()
  await expect(page.locator('.tonight-subject')).toContainText(
    'Another target is selected for the next run',
  )
  active = false
  await expect(page.getByRole('heading', { name: 'Next subject' })).toBeVisible()
  await page.getByRole('spinbutton', { name: 'Exposure · seconds' }).fill('42')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('radio', { name: 'Dark', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('spinbutton', { name: 'Exposure · seconds' })).toHaveValue('42')
  await page.getByRole('button', { name: 'Start capture' }).click()
  await expect
    .poll(() => starts)
    .toEqual([{ exposureSeconds: 42, repeat: true, saveFrames: false, targetId: 'next' }])
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
  await expect(page.locator('.tonight-equipment')).toContainText('-10.0°C · Cooler on')
  await expect(page.locator('.tonight-equipment')).not.toContainText('25.0°C')
  await expect(page.locator('.tonight-sky')).toContainText('Northern sky')
  await expect(page.locator('.tonight-sky')).not.toContainText('Northeastern')
  coolingAvailable = false
  await expect(page.locator('.tonight-equipment')).toContainText('Temperature / cooling unavailable')
  await expect(page.locator('.tonight-equipment')).not.toContainText('25.0°C')
})
