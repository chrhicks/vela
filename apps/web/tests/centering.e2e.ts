import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { FramingCentering, FramingView, TargetView } from '@vela/model/web'

const target: TargetView = { id: 'm31', name: 'Andromeda Galaxy', catalog: 'M31', kind: 'Galaxy', raDegrees: 10.6847, decDegrees: 41.269, sizeArcminutes: 178, thumbnailUrl: '/api/targets/m31/thumbnail', sky: null }

const sample = (correction: number, offsetArcminutes: number, trend: FramingCentering['measurements'][number]['trend']): FramingCentering['measurements'][number] => ({ correction, offsetArcminutes, trend, checkId: `check-${correction}`, capturedAt: new Date().toISOString(), rotationDegrees: 32, pointingSide: 'east', pointingSideChanged: correction === 1 })

function initial(): FramingView {
  return {
    captureReadState: 'current',
    rigId: 'rig-1', rigName: 'Test rig', enabled: true, unavailableReason: null, observedAt: new Date().toISOString(),
    focalLengthMm: 400, camera: { name: 'Test camera', width: 3000, height: 2000, fieldWidthDegrees: 3, fieldHeightDegrees: 2 },
    phase: 'checked', active: false, desired: target, targetId: target.id, error: null, exposureSeconds: 20,
    canCenter: true, checkCurrent: true, pointingSide: 'unknown', centering: null,
    actual: { ...target, ...sample(0, 42.4, 'starting'), corners: [{ raDegrees: 9, decDegrees: 40 }, { raDegrees: 11, decDegrees: 40 }, { raDegrees: 11, decDegrees: 42 }, { raDegrees: 9, decDegrees: 42 }] },
  }
}

async function rig(page: Page) {
  const commands: string[] = []
  const rig = { state: initial(), offline: false, stale: false, commands }
  const response = () => JSON.stringify({ ...rig.state, observedAt: new Date(Date.now() - (rig.stale ? 60000 : 0)).toISOString() })
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => route.fulfill({ json: target }))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/web/rigs/rig-1/framing', route => rig.offline ? route.abort() : route.fulfill({ contentType: 'application/json', body: response() }))
  await page.route('**/api/rigs/rig-1/framing/*', route => {
    const action = route.request().url().split('/').at(-1)!
    rig.commands.push(action)

    if (action === 'center') {
      expect(route.request().postDataJSON()).toEqual({ checkId: 'check-0', raDegrees: target.raDegrees, decDegrees: target.decDegrees })
      rig.state = { ...rig.state, active: true, phase: 'exposing', checkCurrent: false, canCenter: false,
        centering: { toleranceArcminutes: .5, maxCorrections: 4, correction: 1, outcome: 'working', measurements: [sample(0, 42.4, 'starting')] } }
    } else if (action === 'stop') {
      rig.state = { ...rig.state, active: false, phase: 'stopped', centering: { ...rig.state.centering!, outcome: 'interrupted' } }
    } else if (action === 'check') {
      rig.state = { ...rig.state, active: true, phase: 'exposing', centering: null, checkCurrent: false }
    }

    return route.fulfill({ contentType: 'application/json', body: response() })
  })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await expect(page.getByRole('button', { name: 'Center composition', exact: true })).toBeEnabled()

  return rig
}

for (const width of [1280, 390]) {
  test(`fresh centering results replace pending feedback and composition edits discard success at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 })
    const device = await rig(page)
    const status = page.locator('.vela-target-status')
    await page.getByRole('button', { name: 'Center composition', exact: true }).click()
    await expect(status).toContainText('Taking a 20-second test exposure')
    await expect(status).toContainText('Correction 1 of at most 4')
    await expect(page.getByText('Composition centered', { exact: true })).toHaveCount(0)
    device.state = { ...device.state, phase: 'downloading' }
    await expect(status).toContainText('Receiving the image')
    device.state = { ...device.state, phase: 'solving' }
    await expect(status).toContainText('Measuring the new framing')
    const final = sample(1, .35, 'within-tolerance')
    device.state = { ...device.state, active: false, phase: 'checked', checkCurrent: true, canCenter: true, pointingSide: 'east',
      actual: { ...device.state.actual!, ...final }, centering: { ...device.state.centering!, outcome: 'centered', measurements: [sample(0, 42.4, 'starting'), final] } }
    await expect(status).toContainText('Composition centered')
    await expect(page.locator('.vela-target-offset > strong')).toHaveText('0.35′')
    await expect(page.getByRole('region', { name: 'Centering measurements' }).getByRole('listitem')).toHaveCount(2)
    await expect(page.getByText('Within tolerance · side changed')).toBeVisible()
    await expect(page.getByText(/flip expected/i)).toHaveCount(0)
    await expect(page.locator('.vela-working-indicator')).toBeHidden()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    // A result whose check is no longer current must not keep the success label.
    device.state = { ...device.state, checkCurrent: false, canCenter: false }
    await expect(status).toContainText('Composition not checked')
    device.state = { ...device.state, checkCurrent: true, canCenter: true }
    await expect(status).toContainText('Composition centered')
    await page.getByRole('button', { name: 'Adjust composition' }).click()
    await page.getByRole('button', { name: 'Move frame →' }).click()
    await expect(status).toContainText('Composition not checked')
    await expect(page.getByRole('region', { name: 'Centering measurements' })).toHaveCount(0)
    await expect(page.locator('.vela-target-offset')).toHaveCount(0)
    expect(device.commands).toEqual(['center'])
  })
}

for (const outcome of ['not-converging', 'limit-reached'] as const) {
  test(`${outcome} remains a checked result but requires a fresh Check before another Center`, async ({ page }) => {
    const device = await rig(page)
    await page.getByRole('button', { name: 'Center composition', exact: true }).click()
    await expect(page.locator('.vela-target-status')).toContainText('Taking a 20-second test exposure')
    const offsets = outcome === 'not-converging' ? [42.4, 53.8, 67.1] : [42.4, 20, 10, 5, 2]
    const measurements = offsets.map((offset, correction) => sample(correction, offset, correction === 0 ? 'starting' : outcome === 'not-converging' ? 'worsened' : 'improved'))
    device.state = { ...device.state, phase: 'checked', active: false, checkCurrent: true, canCenter: false,
      actual: { ...device.state.actual!, ...measurements.at(-1)! }, centering: { ...device.state.centering!, correction: measurements.length - 1, outcome, measurements } }
    await expect(page.locator('.vela-target-status')).toContainText(outcome === 'not-converging' ? 'Centering is not converging' : 'Centering correction limit reached')
    await expect(page.getByRole('button', { name: 'Center composition', exact: true })).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeVisible()
    await page.getByRole('button', { name: 'Check current frame', exact: true }).click()
    await expect(page.locator('.vela-target-status')).toContainText('Taking a 20-second test exposure')
    await expect(page.getByRole('region', { name: 'Centering measurements' })).toHaveCount(0)
    device.state = { ...device.state, phase: 'checked', active: false, checkCurrent: true, canCenter: true }
    await expect(page.getByRole('button', { name: 'Center composition', exact: true })).toBeEnabled()
    expect(device.commands).toEqual(['center', 'check'])
  })
}

test('long exposure keeps Working visible, stale/offline reads remove activity, and Stop ends it without replay', async ({ page }) => {
  const device = await rig(page)
  await page.getByRole('button', { name: 'Center composition', exact: true }).click()
  const activity = page.locator('.vela-working-indicator')
  await expect(activity).toBeVisible()
  await page.clock.install()
  await page.clock.fastForward(10000)
  await expect(page.locator('.vela-target-status')).toContainText('Taking a 20-second test exposure')
  await expect(activity).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeEnabled()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(await activity.locator('.vela-working-indicator__shimmer').evaluate(element => getComputedStyle(element, '::after').animationName)).toBe('none')
  device.stale = true
  await expect(page.locator('.vela-target-status')).toContainText('Connection interrupted')
  await expect(activity).toBeHidden()
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeDisabled()
  await expect(page.locator('.vela-target-offset > strong')).toHaveText('42.4′')
  device.stale = false
  device.offline = true
  await page.getByRole('button', { name: 'Check rig state' }).click()
  await expect(activity).toBeHidden()
  device.offline = false
  await expect(activity).toBeVisible()
  await page.getByRole('button', { name: 'Stop framing' }).click()
  await expect(page.locator('.vela-target-status')).toContainText('Centering stopped')
  await expect(activity).toBeHidden()
  expect(device.commands).toEqual(['center', 'stop'])
})

test('an uncertain centering response shows neither animation nor success until an explicit state check', async ({ page }) => {
  const device = await rig(page)
  let release!: () => void
  const held = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/rigs/rig-1/framing/center', async route => {
    device.commands.push('center')
    device.state = { ...device.state, phase: 'exposing', active: true, checkCurrent: false }
    await held
    await route.abort()
  })
  await page.getByRole('button', { name: 'Center composition', exact: true }).click()
  await expect(page.locator('.vela-target-status')).toContainText('Sending command')
  await expect(page.locator('.vela-working-indicator')).toBeHidden()
  release()
  await expect(page.getByRole('alert')).toContainText('could not be confirmed')
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeDisabled()
  await expect(page.locator('.vela-working-indicator')).toBeHidden()
  await page.getByRole('button', { name: 'Check rig state' }).click()
  await expect(page.locator('.vela-working-indicator')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeEnabled()
  expect(device.commands).toEqual(['center'])
})

test('an already-close frame requires the fresh no-movement recheck to confirm centered', async ({ page }) => {
  const device = await rig(page)
  const before = sample(0, .35, 'starting')
  device.state = { ...device.state, active: true, phase: 'exposing', checkCurrent: false, canCenter: false,
    actual: { ...device.state.actual!, ...before },
    centering: { toleranceArcminutes: .5, maxCorrections: 4, correction: 0, outcome: 'working', measurements: [before] } }
  await expect(page.locator('.vela-target-status')).toContainText('Checking the current frame before any correction')
  await expect(page.getByText('Composition centered', { exact: true })).toHaveCount(0)
  const after = { ...sample(0, .4, 'within-tolerance'), checkId: 'fresh-no-movement-check' }
  device.state = { ...device.state, active: false, phase: 'checked', checkCurrent: true, actual: { ...device.state.actual!, ...after },
    centering: { ...device.state.centering!, outcome: 'centered', measurements: [before, after] } }
  await expect(page.locator('.vela-target-status')).toContainText('Composition centered')
  const progress = page.getByRole('region', { name: 'Centering measurements' })
  await expect(progress.getByText('Recheck', { exact: true })).toBeVisible()
  await expect(progress.getByText('0 corrections measured', { exact: true })).toBeVisible()
  expect(device.commands).toEqual([])
})
