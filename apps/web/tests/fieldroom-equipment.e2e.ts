import { expect, test, type Page } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { openEquipmentScene } from './fixtures/fieldroom/browser'
import { reviewTimezone } from './fixtures/fieldroom/tonight'
import type { EquipmentScene } from './fixtures/fieldroom/equipment'

test.use({ timezoneId: reviewTimezone })

const cameraPath = '/api/rigs/fra400/imaging-camera'

const focalPath = '/api/rigs/fra400/framing/settings'

const otherCamera = { id: 'other-camera', name: 'ZWO ASI220MM Mini' }

async function editSetup(page: Page) {
  await page.getByRole('combobox', { name: 'Imaging camera', exact: true }).selectOption(otherCamera.id)
  await page.getByRole('spinbutton', { name: 'Effective focal length', exact: true }).fill('500')
}

async function settledLayout(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))
  })
}

test('Equipment saves camera then focal length with exact payloads and suppresses duplicate submission', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'equipment-setup-save')
  scene.setDelay('camera', 500)
  await editSetup(page)
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect.poll(() => scene.writes.length).toBe(1)
  expect(scene.writes[0]).toEqual({ method: 'PUT', pathname: cameraPath, body: otherCamera })
  expect(scene.writes.some(write => write.pathname === focalPath)).toBe(false)
  await expect(page.getByRole('combobox', { name: 'Imaging camera', exact: true })).toBeDisabled()
  await expect.poll(() => scene.writes.length).toBe(2)
  expect(scene.writes[1]).toEqual({ method: 'PUT', pathname: focalPath, body: { focalLengthMm: 500 } })
  await expect(page.getByRole('combobox', { name: 'Imaging camera', exact: true })).toBeEnabled()
  expect(scene.snapshot().camera.selected).toEqual(otherCamera)
  expect(scene.snapshot().framing.focalLengthMm).toBe(500)
  expect(scene.unknownRequests).toEqual([])
})

test('Equipment keeps confirmed camera after focal rejection and retries only the remaining setting', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'equipment-setup-partial')
  await editSetup(page)
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect.poll(() => scene.writes.length).toBe(2)
  await expect(page.getByRole('combobox', { name: 'Imaging camera', exact: true })).toBeEnabled()
  expect(scene.snapshot().camera.selected).toEqual(otherCamera)
  expect(scene.snapshot().framing.focalLengthMm).toBe(400)
  await expect(page.getByRole('spinbutton', { name: 'Effective focal length', exact: true })).toHaveValue('500')
  scene.setWriteOutcome('focal', 'confirmed')
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect.poll(() => scene.writes.length).toBe(3)
  expect(scene.writes.map(write => write.pathname)).toEqual([cameraPath, focalPath, focalPath])
  expect(scene.snapshot().framing.focalLengthMm).toBe(500)
  expect(scene.unknownRequests).toEqual([])
})

test('Equipment checks a lost camera response without continuing or replaying the write', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'equipment-setup-unconfirmed')
  let inspectionAvailable = false
  let inspections = 0
  await editSetup(page)
  await page.route('**/api/web/rigs/fra400/imaging-camera', async route => {
    inspections++

    const result = inspectionAvailable
      ? scene.respond('GET', '/api/web/rigs/fra400/imaging-camera')
      : { status: 503, json: { error: 'inspection-temporarily-unavailable' } }

    await route.fulfill({ status: result.status, json: result.json })
  })
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Check saved setup', exact: true })).toBeVisible()
  expect(scene.writes).toEqual([{ method: 'PUT', pathname: cameraPath, body: otherCamera }])
  await expect(page.getByRole('button', { name: 'Save imaging setup', exact: true })).toBeDisabled()
  const readsBeforeCheck = inspections
  inspectionAvailable = true
  await page.getByRole('button', { name: 'Check saved setup', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save imaging setup', exact: true })).toBeEnabled()
  expect(inspections).toBeGreaterThan(readsBeforeCheck)
  expect(scene.writes).toHaveLength(1)
  await expect(page.getByRole('spinbutton', { name: 'Effective focal length', exact: true })).toHaveValue('500')
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect.poll(() => scene.writes.length).toBe(2)
  expect(scene.writes[1]).toEqual({ method: 'PUT', pathname: focalPath, body: { focalLengthMm: 500 } })
  expect(scene.unknownRequests).toEqual([])
})

test('Equipment explicitly inspects an unknown connection outcome without POST replay', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'equipment-connect-unconfirmed')
  await page.getByRole('button', { name: 'Connect devices', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Check rig state', exact: true })).toBeVisible()
  expect(scene.writes).toHaveLength(1)
  await page.getByRole('button', { name: 'Check rig state', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Check rig state', exact: true })).toHaveCount(0)
  expect(scene.snapshot().rig.connections.connected).toBe(4)
  expect(scene.writes).toHaveLength(1)
  expect(scene.unknownRequests).toEqual([])
})

test('Equipment retains expanded telemetry during interruption and recovers without commands', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'equipment-connected')
  await page.getByRole('button', { name: 'Show ZWO ASI2600MC Pro details', exact: true }).click()
  await expect(page.getByText('38%', { exact: true })).toBeVisible()
  scene.setDetailFailure(503)
  await page.getByRole('button', { name: 'Refresh state', exact: true }).click()
  await expect(page.getByText(/last known/i).first()).toBeVisible()
  await expect(page.getByRole('button', { name: 'Hide ZWO ASI2600MC Pro details', exact: true })).toBeVisible()
  await expect(page.getByText('38%', { exact: true })).toBeVisible()
  scene.setDetailFailure(null)
  await page.getByRole('button', { name: 'Refresh state', exact: true }).click()
  await expect(page.getByText(/last known/i)).toHaveCount(0)
  expect(scene.writes).toEqual([])
  expect(scene.unknownRequests).toEqual([])
})

test('Equipment disclosures retain partial, unknown, unitless switch and unsupported states', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'equipment-details-all-kinds')

  for (const name of ['ZWO Focuser', 'Observing conditions', 'Power controller', 'dome review device']) {
    await page.getByRole('button', { name: `Show ${name} details`, exact: true }).click()
  }

  await expect(page.getByText('Unknown channel', { exact: true })).toBeVisible()
  await expect(page.getByText('0.35', { exact: true })).toBeVisible()
  await expect(page.getByText('12 · On', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'dome review device', exact: true }).getByText('Detailed status is not available', { exact: true })).toBeVisible()
  expect(scene.writes).toEqual([])
  expect(scene.unknownRequests).toEqual([])
})

test('Home retains the previous catalog when confirmed Add is followed by a failed refresh', async ({ page }) => {
  const { scene } = await openEquipmentScene(page, 'home-rigs')
  const endpoint = { host: 'review-second.invalid', port: 11111 }
  scene.setDiscovery({ candidates: [{ endpoint, inspectedAt: scene.time,
    server: { name: 'Second rig' }, devices: [{ name: 'Review camera', kind: 'camera' }],
    disposition: { state: 'new' } }], failures: [] })
  const added: Array<{ name: string; endpoint: { host: string; port: number } }> = []
  await page.route('**/api/rigs', async route => {
    added.push(route.request().postDataJSON())
    scene.setHomeFailure(503)
    await route.fulfill({ status: 201, json: { rigId: 'second-rig' } })
  })
  await page.getByRole('button', { name: 'Add a rig', exact: true }).click()
  await page.getByRole('button', { name: 'Scan the network', exact: true }).click()
  await page.getByRole('button', { name: /Second rig.*review-second/ }).click()
  await page.getByRole('button', { name: 'Review rig', exact: true }).click()
  await page.getByRole('textbox', { name: 'Rig name', exact: true }).fill('Second rig')
  await page.getByRole('button', { name: 'Add rig', exact: true }).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('Showing the previous state')
  await expect(page.getByRole('link', { name: 'View Askar FRA 400', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'View Seestar', exact: true })).toBeVisible()
  expect(added).toEqual([{ name: 'Second rig', endpoint }])
  expect(scene.unknownRequests).toEqual([])
})

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 900, 390]) {
    for (const surface of ['equipment', 'home-no-rigs', 'home-rigs'] as const) {
      test(`${surface} ${mode} reference layout at ${width}`, async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : surface === 'equipment' ? 921 : 900 })

        const name: EquipmentScene = surface === 'equipment'
          ? mode === 'dark' ? 'equipment-dark' : 'equipment-connected'
          : mode === 'dark' ? `${surface}-dark` : surface

        const { scene, requests } = await openEquipmentScene(page, name)
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible()

        if (surface === 'equipment') {
          await expect(page.getByRole('combobox', { name: 'Imaging camera', exact: true })).toHaveValue('camera')
          await expect(page.getByRole('button', { name: 'Show ZWO ASI2600MC Pro details', exact: true })).toBeVisible()
        } else if (surface === 'home-no-rigs') {
          await expect(page.getByRole('button', { name: 'Add a rig', exact: true })).toBeVisible()
          await expect(page.getByRole('dialog')).toHaveCount(0)
          expect(requests.some(request => /\/api\/(?:web\/)?rigs\//.test(request))).toBe(false)
        } else {
          await expect(page.getByRole('link', { name: 'View Askar FRA 400', exact: true })).toBeVisible()
          await expect(page.getByRole('link', { name: 'View Seestar', exact: true })).toHaveAttribute('href', '/rigs/seestar')
          await expect(page.getByRole('link', { name: 'View Portable rig', exact: true })).toHaveAttribute('href', '/rigs/portable')
        }

        await settledLayout(page)

        const geometry = await page.evaluate(() => ({
          viewport: { width: innerWidth, height: innerHeight },
          main: document.querySelector('main')!.getBoundingClientRect().toJSON(),
          heading: document.querySelector('h1')!.getBoundingClientRect().toJSON(),
          content: Array.from(document.querySelectorAll('main section, main form, main article')).map(element => ({ className: element.className, bounds: element.getBoundingClientRect().toJSON() })),
          fonts: { heading: getComputedStyle(document.querySelector('h1')!).fontFamily, body: getComputedStyle(document.body).fontFamily },
          overflow: document.documentElement.scrollWidth > innerWidth,
        }))

        expect(geometry.overflow).toBe(false)
        writeFileSync(`/tmp/vela-${surface}-${mode}-${width}-geometry.json`, JSON.stringify(geometry, null, 2))
        await page.screenshot({ path: `/tmp/vela-${surface}-${mode}-${width}.png`, fullPage: true })
        expect(scene.writes).toEqual([])
        expect(scene.unknownRequests).toEqual([])
      })
    }
  }
}
