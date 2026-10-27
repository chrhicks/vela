import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import type { CaptureView, MountControlView, RigTelescopeDeviceView } from '@vela/model/web'
import { createEquipmentScene } from './fixtures/fieldroom/equipment'
import { routeQuietAlerts } from './fixtures/fieldroom/browser'

const rigId = 'fra400'

const holdReason = 'Blocked until a person recovers it: home on ZWO AM5: stop was not confirmed within 20s'

const serverInstanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const on = { enabled: true, reason: null }

const off = { enabled: false, reason: 'The mount state does not permit this action.' }

const mountControl: MountControlView = {
  serverInstanceId, unpark: off, trackingOn: on, trackingOff: off, home: on, stop: on, homeConfirmedAt: null, command: null,
}

const idle: CaptureView = {
  captureReadState: 'current',
  rigId,
  rigName: 'Askar FRA 400',
  camera: { name: 'Main camera' },
  enabled: true,
  unavailableReason: null,
  phase: 'idle',
  active: false,
  exposureSeconds: 2,
  elapsedSeconds: 0,
  error: null,
  saveFrames: false,
  frameType: 'light',
  savedImageCount: 0,
  unattended: false,
  subject: null,
  savedCount: 0,
  integrationSeconds: 0,
  latestImage: null,
  repeat: true,
  completedCount: 0,
  cooling: { state: 'off', canSetTemperature: true, setpointC: 5, sensorTemperatureC: 8 },
}

const exposing: CaptureView = {
  ...idle,
  phase: 'exposing',
  active: true,
  cooling: { ...idle.cooling!, blockedBy: 'capture' },
}

const respond = <Body>(route: Route, body: Body, status = 200) => route.fulfill({ status, json: body })

/** A rig with a mount, a held focuser, a camera cooler and a capture run the tests can start and stop. */
async function controlsScene(page: Page, options: { mount?: boolean; held?: boolean; capture?: CaptureView | null } = {}) {
  const { mount = true, held = true } = options
  const scene = createEquipmentScene('equipment-connected')
  const writes: Array<{ method: string; path: string; body: unknown }> = []
  let capture: CaptureView | null = options.capture === undefined ? idle : options.capture
  const rig = scene.snapshot().rig

  scene.setRig({
    ...rig,
    devices: rig.devices.flatMap(device => {
      if (device.kind === 'telescope') {
        if (!mount) return []

        return [{
          ...device, connection: 'connected', observedAt: scene.time,
          observation: { state: 'current', commandReady: true, observedAt: scene.time },
          status: { availability: 'complete', activity: 'idle', tracking: 'off', parking: 'unparked', home: 'away' },
          mountControl,
        } satisfies RigTelescopeDeviceView]
      }

      if (device.kind === 'focuser' && held) {
        return [{
          ...device,
          observation: { state: 'current', commandReady: false, observedAt: scene.time, message: holdReason, hold: { deviceId: 'cria:fra400:focuser', reason: holdReason } },
        }]
      }

      return [device]
    }),
  })

  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'No fixture for this request' } }))
  await page.route('**/api/web/navigation', route => respond(route, { rigs: [], captures: [] }))
  await page.route('**/api/web/rigs/fra400', route => respond(route, scene.snapshot().rig))
  await page.route('**/api/web/rigs/fra400/capture', route => capture ? respond(route, capture) : respond(route, { error: 'No camera' }, 503))
  await page.route('**/api/rigs/fra400/capture/cooling', route => {
    const body = route.request().postDataJSON()

    writes.push({ method: 'POST', path: 'cooling', body })
    capture = { ...capture!, cooling: { ...capture!.cooling!, state: body.coolerOn ? 'on' : 'off' } }

    return respond(route, capture)
  })
  await page.route('**/api/rigs/fra400/capture/unattended', route => {
    const body = route.request().postDataJSON()

    writes.push({ method: 'PUT', path: 'unattended', body })
    capture = { ...capture!, unattended: body.on }

    return respond(route, capture)
  })
  await page.route('**/api/rigs/fra400/devices/*/recover', route => {
    writes.push({ method: 'POST', path: 'recover', body: route.request().postDataJSON() })

    return respond(route, { outcome: 'confirmed', found: 'Cria recovered the focuser' })
  })
  await routeQuietAlerts(page)

  return { writes, setCapture: (value: CaptureView | null) => { capture = value } }
}

const controlsButton = (page: Page) => page.getByRole('button', { name: 'Controls', exact: true })

const panel = (page: Page) => page.getByRole('dialog', { name: 'Controls' })

async function openPanel(page: Page) {
  await controlsButton(page).click()
  await expect(panel(page)).toBeVisible()
}

const pages = [
  '/rigs/fra400',
  '/rigs/fra400/observe',
  '/rigs/fra400/observe/capture',
  '/rigs/fra400/observe/targets',
  '/rigs/fra400/observe/saved-images',
  '/rigs/fra400/observe/alignment',
  '/rigs/fra400/observe/autofocus',
]

for (const width of [390, 1440]) {
  for (const path of pages) {
    test(`${path} has a Controls button that opens the panel at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await controlsScene(page)
      await page.goto(path)
      await expect(controlsButton(page)).toBeVisible()
      await openPanel(page)
      await expect(panel(page).getByRole('region', { name: 'Mount' })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    })
  }
}

test('Controls is not offered outside a rig', async ({ page }) => {
  await controlsScene(page)
  await page.route('**/api/web/home', route => respond(route, { rigs: [], simulatorAvailable: false }))
  await page.goto('/explore')
  await expect(page.getByRole('button', { name: 'Appearance' })).toBeVisible()
  await expect(controlsButton(page)).toHaveCount(0)
})

test('the panel is a bottom sheet on a phone and a side panel on a wide screen', async ({ page }, testInfo) => {
  await controlsScene(page, { capture: exposing })
  await page.goto('/rigs/fra400/observe/capture')

  await page.setViewportSize({ width: 390, height: 844 })
  await openPanel(page)

  const bottomEdge = async () => {
    const box = (await panel(page).boundingBox())!

    return { x: box.x, width: box.width, bottom: box.y + box.height, fits: box.height < 844 }
  }

  await expect.poll(bottomEdge).toEqual({ x: 0, width: 390, bottom: 844, fits: true })
  await page.screenshot({ path: testInfo.outputPath('rig-controls-390.png') })

  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)

  await page.setViewportSize({ width: 1440, height: 900 })
  await openPanel(page)
  await expect.poll(async () => {
    const box = (await panel(page).boundingBox())!

    return { right: box.x + box.width, top: box.y, height: box.height, narrow: box.width < 500 }
  }).toEqual({ right: 1440, top: 0, height: 900, narrow: true })
  await page.screenshot({ path: testInfo.outputPath('rig-controls-1440.png') })
})

test('sections appear in order for what the rig has, and Phone only while a run is active', async ({ page }) => {
  const fixture = await controlsScene(page, { capture: exposing })
  await page.goto('/rigs/fra400')
  await openPanel(page)
  const headings = panel(page).getByRole('heading', { level: 3 })

  await expect(headings).toHaveText(['Mount', 'Cooler', 'Phone', 'Clear hold'])

  fixture.setCapture(idle)
  await expect(headings).toHaveText(['Mount', 'Cooler', 'Clear hold'])
  expect(fixture.writes).toEqual([])
})

test('a rig without a mount, camera or hold says there is nothing to control', async ({ page }) => {
  await controlsScene(page, { mount: false, held: false, capture: null })
  await page.goto('/rigs/fra400')
  await openPanel(page)
  await expect(panel(page).getByRole('heading', { level: 3 })).toHaveCount(0)
  await expect(panel(page).getByText('This rig has nothing to control right now.')).toBeVisible()
})

test('the cooler switch is in the panel only, and a run disables it with the reason', async ({ page }) => {
  const fixture = await controlsScene(page)

  for (const path of ['/rigs/fra400/observe/capture', '/rigs/fra400/observe']) {
    await page.goto(path)
    await expect(page.getByRole('checkbox', { name: 'Cooler on' })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: 'Cooler on' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Camera cooling' })).toHaveCount(0)
  }

  await openPanel(page)
  await panel(page).getByText('Cooler on', { exact: true }).click()
  await expect.poll(() => fixture.writes).toEqual([{ method: 'POST', path: 'cooling', body: { coolerOn: true } }])
  await expect(panel(page).getByRole('checkbox', { name: 'Cooler on' })).toBeChecked()

  fixture.setCapture(exposing)
  await expect(panel(page).getByRole('checkbox', { name: 'Cooler on' })).toBeDisabled()
  await expect(panel(page).getByText('Cooling is locked while capture runs so Stop stays available.')).toBeVisible()
})

test('the live Unattended switch is in the panel only; the capture page shows its value as text', async ({ page }) => {
  const fixture = await controlsScene(page, { capture: exposing })
  await page.goto('/rigs/fra400/observe/capture')
  const run = page.getByRole('region', { name: 'Capture images' })

  await expect(run).toContainText('Phone: off')
  await expect(page.getByRole('checkbox', { name: /Unattended/ })).toHaveCount(0)

  await openPanel(page)
  await panel(page).getByText('Unattended (page my phone)', { exact: true }).click()
  await expect(panel(page).getByRole('checkbox', { name: /Unattended/ })).toBeChecked()
  await expect(panel(page)).toContainText('Phone: on, unattended')
  expect(fixture.writes).toEqual([{ method: 'PUT', path: 'unattended', body: { on: true } }])

  await page.keyboard.press('Escape')
  await expect(run).toContainText('Phone: on, unattended')
  await expect(page.getByRole('button', { name: 'Stop capture' })).toBeEnabled()
})

test('the capture start form keeps its Unattended checkbox for the next run', async ({ page }) => {
  await controlsScene(page)
  await page.goto('/rigs/fra400/observe/capture')
  await expect(page.getByRole('checkbox', { name: 'Unattended (page my phone)' })).toBeVisible()
})

test('Clear hold lives in the panel: one confirmed request, and the panel stays open', async ({ page }) => {
  const fixture = await controlsScene(page)
  await page.goto('/rigs/fra400')

  const row = page.getByRole('region', { name: 'ZWO Focuser' })

  await expect(row.getByRole('group', { name: 'ZWO Focuser is held' })).toContainText(holdReason)
  await expect(page.getByRole('button', { name: 'Clear hold' })).toHaveCount(0)
  await expect(row.getByText('Clear the hold in Controls.')).toBeVisible()

  await openPanel(page)
  const held = panel(page).getByRole('group', { name: 'ZWO Focuser is held' })

  await expect(page.getByRole('button', { name: 'Clear hold' })).toHaveCount(1)
  await held.getByRole('button', { name: 'Clear hold' }).click()
  const confirm = page.getByRole('dialog', { name: 'Clear the hold on ZWO Focuser?' })

  await expect(confirm.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  expect(fixture.writes).toEqual([])

  await held.getByRole('button', { name: 'Clear hold' }).click()
  await confirm.getByRole('button', { name: 'I have checked it, clear the hold' }).dblclick()
  await expect(confirm).toHaveCount(0)
  await expect(panel(page)).toBeVisible()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.writes[0]).toMatchObject({ method: 'POST', path: 'recover' })
})

test('Your rig keeps readings and no longer holds tracking, Unpark or Clear hold buttons', async ({ page }) => {
  await controlsScene(page)
  await page.goto('/rigs/fra400')
  await expect(page.getByRole('region', { name: 'ASI Mount' })).toBeVisible()
  await expect(page.getByRole('button', { name: /tracking|Unpark|Clear hold/i })).toHaveCount(0)
})

test('Escape closes the panel and returns focus to the Controls button', async ({ page }) => {
  await controlsScene(page)
  await page.goto('/rigs/fra400/observe/capture')
  await openPanel(page)
  await page.keyboard.press('Escape')
  await expect(panel(page)).toHaveCount(0)
  await expect(controlsButton(page)).toBeFocused()
})
