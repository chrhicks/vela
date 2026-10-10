import { expect, test } from '@playwright/test'
import type { CaptureView } from '@vela/model/web'
import { openExploreScene } from './fixtures/fieldroom/browser'
import { createTonightScene, reviewTime } from './fixtures/fieldroom/tonight'
import { isCaptureView } from '../src/features/capture/validation'

/** The review scenes answer capture reads with a validated CaptureView. */
function sceneCapture(scene: { respond(method: string, pathname: string): { json?: unknown } }, rigId: string) {
  const view = scene.respond('GET', `/api/web/rigs/${rigId}/capture`).json

  if (!isCaptureView(view, rigId)) throw new Error('Review scene returned an invalid capture view')

  return view
}

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
  subject: null,
  savedCount: 0,
  integrationSeconds: 0,
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
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'No fixture for this request' } }))
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
  await page.getByText('Camera cooling', { exact: true }).first().click()
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
  await expect(page.getByRole('button', { name: 'Stop capture' })).toBeEnabled()
  await expect(warning).toBeVisible()
  await expect(check).toBeDisabled()
  await page.getByRole('button', { name: 'Stop capture' }).click()
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
  await page.getByText('Camera cooling', { exact: true }).first().click()
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  await cooling.getByText('Cooler on', { exact: true }).click()
  await expect(cooling.getByText('Cooler command outcome unknown.', { exact: false })).toBeVisible()
  await cooling.getByRole('button', { name: 'Check camera cooling' }).click()
  await expect(cooling.getByRole('button', { name: 'Check camera cooling' })).toHaveCount(0)
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeChecked()
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeEnabled()
})

// Polar alignment holds the rig on the server; a cooling command would be refused.
const alignmentHolds = (view: CaptureView): CaptureView => ({
  ...view,
  enabled: false,
  unavailableReason: 'Another Rig operation is in progress.',
  cooling: { ...view.cooling!, state: 'off', powerPercent: 0, blockedBy: 'alignment' },
})

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`Tonight names what holds cooling beside the disabled switch and sends nothing (${mode}, ${width}px)`, async ({
      page,
    }) => {
      const scene = createTonightScene('tonight-idle')
      let blocked = true
      const commands: unknown[] = []
      await page.setViewportSize({ width, height: width === 1440 ? 965 : 782 })
      await page.clock.setFixedTime(new Date(reviewTime))
      await page.addInitScript(value => localStorage.setItem('vela.appearance', value), mode)
      await page.route('**/api/**', route => {
        const request = route.request()
        const pathname = new URL(request.url()).pathname

        if (request.method() === 'POST' && pathname === '/api/rigs/fra400/capture/cooling') {
          commands.push(request.postDataJSON())
          const view = sceneCapture(scene, 'fra400')

          return route.fulfill({ json: { ...view, cooling: { ...view.cooling!, state: 'on' } } })
        }

        if (request.method() === 'GET' && pathname === '/api/web/rigs/fra400/capture') {
          const view = sceneCapture(scene, 'fra400')

          return route.fulfill({
            json: blocked ? alignmentHolds(view) : { ...view, cooling: { ...view.cooling!, state: 'off' } },
          })
        }

        const response = scene.respond(request.method(), pathname)

        return route.fulfill({ status: response.status, json: response.json })
      })
      await page.goto(scene.route)
      await page.getByRole('button', { name: 'Camera cooling', exact: true }).click()

      const cooling = page.getByRole('region', { name: 'Camera cooling' })
      const switchControl = cooling.getByRole('checkbox', { name: 'Cooler on' })
      const blocker = cooling.getByRole('status').filter({ hasText: 'Cooling unavailable' })
      await expect(switchControl).toBeDisabled()
      await expect(blocker).toContainText('Polar alignment is using the rig.')
      await expect(blocker.getByRole('link', { name: 'Open polar alignment' })).toHaveAttribute(
        'href',
        '/rigs/fra400/observe/alignment',
      )

      // Directly below the control it explains, inside the cooling card.
      const control = (await cooling.locator('.vela-checkbox').boundingBox())!
      const feedback = (await blocker.boundingBox())!
      expect(feedback.y).toBeGreaterThanOrEqual(control.y + control.height)
      expect(feedback.y - (control.y + control.height)).toBeLessThan(24)
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)

      await blocker.scrollIntoViewIfNeeded()
      await page.evaluate(() => document.fonts.ready)
      await page.screenshot({ path: `/tmp/vela-cooling-blocked-${mode}-${width}.png` })
      await cooling.screenshot({ path: `/tmp/vela-cooling-blocked-card-${mode}-${width}.png` })

      await cooling.getByText('Cooler on', { exact: true }).click({ force: true })
      await page.waitForTimeout(300)
      expect(commands).toEqual([])

      blocked = false
      await expect(switchControl).toBeEnabled()
      await expect(blocker).toHaveCount(0)
      await cooling.getByText('Cooler on', { exact: true }).click()
      await expect(switchControl).toBeChecked()
      expect(commands).toEqual([{ coolerOn: true }])
    })
  }
}

test('a refused cooling tap leaves the switch and page where they were on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 782 })
  await page.route('**/api/web/rigs/rig-1/capture', route => route.fulfill({ json: idle }))
  await page.route('**/api/rigs/rig-1/capture/cooling', async route => {
    await new Promise(resolve => setTimeout(resolve, 300))

    return route.fulfill({ status: 409, json: { error: 'Another Rig operation is in progress.' } })
  })
  await page.goto('/rigs/rig-1/observe/capture')
  await page.getByText('Camera cooling', { exact: true }).first().click()
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  const switchControl = cooling.locator('.vela-checkbox')
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))

  const position = async () => ({
    scrollY: await page.evaluate(() => Math.round(window.scrollY)),
    controlY: Math.round((await switchControl.boundingBox())!.y),
  })

  const before = await position()
  await cooling.getByText('Cooler on', { exact: true }).click()
  await expect(cooling.getByText('Confirming cooler state…')).toBeVisible()
  expect(await position()).toEqual(before)
  await expect(cooling.getByRole('status').filter({ hasText: 'Cooling command failed' })).toContainText(
    'Another Rig operation is in progress.',
  )
  expect(await position()).toEqual(before)
})

test('Observe disables its cooling switch with the same server reason', async ({ page }) => {
  const { scene } = await openExploreScene(page, 'preparation-light')
  await page.route('**/api/web/rigs/fra400/capture', route =>
    route.fulfill({
      json: alignmentHolds(sceneCapture(scene, 'fra400')),
    }),
  )
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  await expect(cooling.getByRole('switch', { name: 'Cooler on' })).toBeDisabled()
  await expect(cooling.getByText('Polar alignment is using the rig.', { exact: false })).toBeVisible()
  await expect(cooling.getByRole('link', { name: 'Open polar alignment' })).toHaveAttribute(
    'href',
    '/rigs/fra400/observe/alignment',
  )
  expect(scene.commands).toEqual([])
})

for (const width of [320, 390]) {
  for (const canSetTemperature of [false, true]) {
    test(`repeated refused taps keep the Tonight switch and page still at ${width}px (setpoint control ${canSetTemperature ? 'on' : 'off'})`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 782 })

      const current: CaptureView = {
        ...idle,
        cooling: canSetTemperature
          ? { state: 'off', canSetTemperature, setpointC: 5, sensorTemperatureC: 18 }
          : { state: 'off', canSetTemperature, sensorTemperatureC: 18 },
      }

      let commands = 0
      await page.route('**/api/web/rigs/rig-1/capture', route => route.fulfill({ json: current }))
      await page.route('**/api/rigs/rig-1/capture/cooling', async route => {
        commands++
        await new Promise(resolve => setTimeout(resolve, 600))

        return route.fulfill({ status: 409, json: { error: 'Another Rig operation is in progress.' } })
      })
      await page.goto('/rigs/rig-1/observe/capture')
      await page.getByRole('button', { name: 'Camera cooling', exact: true }).click()
      const cooling = page.getByRole('region', { name: 'Camera cooling' })
      const refusal = cooling.getByRole('status').filter({ hasText: 'Cooling command failed' })
      const confirming = cooling.getByText('Confirming cooler state…')
      await page.evaluate(() => document.fonts.ready)

      const position = async () => ({
        scrollY: await page.evaluate(() => Math.round(window.scrollY)),
        switchY: Math.round((await cooling.locator('.vela-checkbox').boundingBox())!.y),
      })

      // First tap from a clean card, then a repeated tap while the refusal is shown.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const clean = await position()
      await cooling.getByText('Cooler on', { exact: true }).click()
      await expect(confirming).toBeVisible()
      expect(await position()).toEqual(clean)
      await expect(refusal).toBeVisible()
      await expect(confirming).toBeHidden()

      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      const refused = await position()
      await cooling.getByText('Cooler on', { exact: true }).click()
      await expect(confirming).toBeVisible()
      await expect(refusal).toHaveCount(0)
      expect(await position()).toEqual(refused)
      await expect(refusal).toBeVisible()
      expect(await position()).toEqual(refused)
      expect(commands).toBe(2)
    })
  }
}

test('an unknown turn-off with failed reads labels cooling last known without moving the switch', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 782 })
  let offline = false
  let commands = 0

  const current: CaptureView = {
    ...idle,
    cooling: { state: 'on', canSetTemperature: false, sensorTemperatureC: 18 },
  }

  await page.route('**/api/web/rigs/rig-1/capture', route =>
    route.fulfill(offline ? { status: 503, json: { error: 'Review offline' } } : { json: current }),
  )
  await page.route('**/api/rigs/rig-1/capture/cooling', route => {
    commands++
    offline = true

    return route.abort()
  })
  await page.goto('/rigs/rig-1/observe/capture')
  await page.getByRole('button', { name: 'Camera cooling', exact: true }).click()
  const cooling = page.getByRole('region', { name: 'Camera cooling' })
  await expect(cooling.getByRole('heading', { name: 'Cooling', exact: true })).toBeVisible()

  const switchOffset = async () => {
    const card = (await cooling.boundingBox())!
    const control = (await cooling.locator('.vela-checkbox').boundingBox())!

    return Math.round(control.y - card.y)
  }

  const before = await switchOffset()
  await cooling.getByText('Cooler on', { exact: true }).click()
  await expect(cooling.getByText('Cooler command outcome unknown.', { exact: false })).toBeVisible()
  await expect(page.locator('[data-interrupted="true"]')).toBeVisible()
  await expect(cooling.getByRole('heading', { name: 'Cooling · last known' })).toBeVisible()
  await expect(cooling).not.toContainText('live')
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeDisabled()
  await expect(cooling.getByRole('checkbox', { name: 'Cooler on' })).toBeChecked()
  expect(await switchOffset()).toBe(before)
  await page.waitForTimeout(1500)
  await expect(cooling.getByText('Cooler command outcome unknown.', { exact: false })).toBeVisible()
  expect(commands).toBe(1)
})

for (const width of [320, 390]) {
  test(`a refused tap keeps the Observe cooling switch still at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 782 })
    const { scene } = await openExploreScene(page, 'preparation-light')
    let commands = 0
    await page.route('**/api/rigs/fra400/capture/cooling', async route => {
      commands++
      await new Promise(resolve => setTimeout(resolve, 600))

      return route.fulfill({ status: 409, json: { error: 'Another Rig operation is in progress.' } })
    })
    const cooling = page.getByRole('region', { name: 'Camera cooling' })
    const control = cooling.getByRole('switch', { name: 'Cooler on' })
    await expect(control).toBeEnabled()
    await control.scrollIntoViewIfNeeded()
    await page.evaluate(() => document.fonts.ready)

    const position = async () => ({
      scrollY: await page.evaluate(() => Math.round(window.scrollY)),
      switchY: Math.round((await control.boundingBox())!.y),
    })

    const before = await position()
    await control.click()
    await expect(cooling.getByText('Confirming cooler state…')).toBeVisible()
    expect(await position()).toEqual(before)
    await expect(cooling.getByText('Another Rig operation is in progress.')).toBeVisible()
    expect(await position()).toEqual(before)
    await control.click()
    await expect(cooling.getByText('Confirming cooler state…')).toBeVisible()
    expect(await position()).toEqual(before)
    await expect(cooling.getByText('Another Rig operation is in progress.')).toBeVisible()
    expect(await position()).toEqual(before)
    expect(commands).toBe(2)
    expect(scene.unknownRequests).toEqual([])
  })
}
