import { expect, test, type Page, type Route } from '@playwright/test'
import type { MountControlView, RigTelescopeDeviceView } from '@vela/model/web'
import { createEquipmentScene } from './fixtures/fieldroom/equipment'
import { openExploreScene } from './fixtures/fieldroom/browser'
import { reviewFraming } from './fixtures/fieldroom/explore'

const deviceId = 'fra400-mount'

const mountPath = '/api/rigs/fra400/mount'

const on = { enabled: true, reason: null }

const off = { enabled: false, reason: 'The mount state does not permit this action.' }

const serverInstanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const available: MountControlView = { serverInstanceId, unpark: off, trackingOn: on, trackingOff: off, command: null }

type Command = NonNullable<MountControlView['command']>

type Write = { serverInstanceId: string; deviceId: string; action: Command['action']; requestId: string }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })

  return { promise, resolve }
}

async function mountScene(page: Page, mode: 'light' | 'dark' = 'light') {
  const scene = createEquipmentScene(mode === 'dark' ? 'equipment-dark' : 'equipment-connected')
  const writes: Write[] = []
  const checks: Write[] = []
  let admission: 'known' | 'not-admitted' | 'unknown' = 'known'

  let handleCheck = () => {}

  let handleWrite: (route: Route, body: Write) => Promise<void> = route => route.fulfill({ status: 500 })
  let holdDetail: Promise<void> | null = null

  function setMount(tracking: 'on' | 'off' | 'unknown', parking: 'parked' | 'unparked' | 'unknown', view: MountControlView = available, interrupted = false) {
    const rig = scene.snapshot().rig
    scene.setRig({ ...rig, devices: rig.devices.map(device => device.id === deviceId ? {
      ...device, kind: 'telescope', connection: 'connected', observedAt: scene.time,
      observation: { state: interrupted ? 'interrupted' : 'current', commandReady: !interrupted, observedAt: scene.time },
      status: { availability: 'complete', activity: tracking === 'on' ? 'tracking' : 'idle', tracking, parking, home: 'away' },
      mountControl: view,
    } satisfies RigTelescopeDeviceView : device) })
  }

  setMount('off', 'unparked')
  await page.addInitScript(value => localStorage.setItem('vela.appearance', value), mode)
  await page.route('**/api/**', async route => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname

    if (request.method() === 'POST' && pathname === mountPath) {
      const body: Write = request.postDataJSON()
      writes.push(body)
      await handleWrite(route, body)

      return
    }

    if (request.method() === 'POST' && pathname === `${mountPath}/check`) {
      checks.push(request.postDataJSON())
      handleCheck()
      const device = scene.snapshot().rig.devices.find(value => value.kind === 'telescope' && value.id === deviceId)

      if (device?.kind !== 'telescope') throw new Error('Mount fixture is missing')
      await route.fulfill({ json: { admission, control: device.mountControl } })

      return
    }

    if (pathname === '/api/web/rigs/fra400' && holdDetail) await holdDetail
    const response = scene.respond(request.method(), pathname, request.postData() ? request.postDataJSON() : undefined)
    await route.fulfill({ status: response.status, json: response.json })
  })

  return {
    scene, writes, checks, setMount,
    setAdmission(value: typeof admission) { admission = value },
    handleCheck(handler: () => void) { handleCheck = handler },
    handleWrite(handler: typeof handleWrite) { handleWrite = handler },
    holdDetail(promise: Promise<void> | null) { holdDetail = promise },
    open: () => page.goto('/rigs/fra400#mount-controls'),
  }
}

function mount(page: Page) {
  return page.getByRole('region', { name: 'ASI Mount', exact: true })
}

test('tracking writes once, stays pending with observed off state, and waits for fresh detail', async ({ page }) => {
  const fixture = await mountScene(page)
  const response = deferred()
  const detail = deferred()
  fixture.handleWrite(async (route, body) => {
    await response.promise
    await route.fulfill({ json: { ...available, command: { ...body, state: 'confirmed', message: 'Tracking is on.' } } })
  })
  await fixture.open()
  await expect(page.locator('#mount-controls')).toBeFocused()
  await expect(mount(page).getByRole('button', { name: 'Hide ASI Mount details' })).toHaveAttribute('aria-expanded', 'true')
  fixture.holdDetail(detail.promise)
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turning tracking on…', exact: true })).toBeDisabled()
  await expect(mount(page).getByText('Tracking off', { exact: true })).toBeVisible()
  expect(fixture.writes).toEqual([{ serverInstanceId, deviceId, action: 'tracking-on', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) }])
  const freshRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/web/rigs/fra400')
  response.resolve()
  await freshRead
  await expect(mount(page).getByRole('button', { name: 'Turning tracking on…', exact: true })).toBeDisabled()
  await expect(mount(page).getByText('Tracking off', { exact: true })).toBeVisible()
  fixture.setMount('on', 'unparked', { ...available, trackingOn: off, trackingOff: on, command: { ...fixture.writes[0]!, state: 'confirmed', message: 'Tracking is on.' } })
  detail.resolve()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  await expect(mount(page).getByText('Tracking on', { exact: true })).toBeVisible()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('unpark is a separate command and displays the freshly observed tracking combination', async ({ page }) => {
  const fixture = await mountScene(page)
  fixture.setMount('off', 'parked', { ...available, unpark: on, trackingOn: off })
  fixture.handleWrite(async (route, body) => {
    const command: Command = { ...body, state: 'confirmed', message: 'Mount is unparked.' }
    fixture.setMount('on', 'unparked', { ...available, trackingOn: off, trackingOff: on, command })
    await route.fulfill({ json: { ...available, command } })
  })
  await fixture.open()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  await mount(page).getByRole('button', { name: 'Unpark mount', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  await expect(mount(page).getByRole('button', { name: 'Unpark mount', exact: true })).toHaveCount(0)
  await expect(mount(page).getByText('Tracking on', { exact: true })).toBeVisible()
  expect(fixture.writes).toEqual([{ serverInstanceId, deviceId, action: 'unpark', requestId: expect.any(String) }])
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('a delayed pre-command refresh cannot replace the confirmed post-command observation', async ({ page }) => {
  const fixture = await mountScene(page)
  const oldRead = deferred()
  const oldReadFinished = deferred()
  let reads = 0
  await page.route('**/api/web/rigs/fra400', async route => {
    reads++
    const detail = fixture.scene.snapshot().rig

    if (reads === 2) {
      await oldRead.promise
      await route.fulfill({ json: detail })
      oldReadFinished.resolve()

      return
    }

    await route.fulfill({ json: detail })
  })
  fixture.handleWrite(async (route, body) => {
    const control = { ...available, trackingOn: off, trackingOff: on,
      command: { ...body, state: 'confirmed' as const, message: 'Tracking is on.' } }

    fixture.setMount('on', 'unparked', control)
    await route.fulfill({ json: control })
  })
  await fixture.open()
  await page.getByRole('button', { name: 'Refresh state', exact: true }).click()
  await expect.poll(() => reads).toBe(2)
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  expect(reads).toBe(3)
  oldRead.resolve()
  await oldReadFinished.promise
  await expect(mount(page).getByText('Tracking on', { exact: true })).toBeVisible()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('unknown or interrupted mount observations prevent physical commands', async ({ page }) => {
  const fixture = await mountScene(page)
  fixture.setMount('unknown', 'unknown', { ...available, unpark: off, trackingOn: off, trackingOff: off, command: null })
  await fixture.open()
  await expect(mount(page).getByText('Tracking unknown', { exact: true }).first()).toBeVisible()
  await expect(mount(page).getByRole('button', { name: 'Unpark mount', exact: true })).toBeDisabled()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  fixture.setMount('off', 'unparked', available, true)
  await mount(page).getByRole('button', { name: 'Check mount state', exact: true }).click()
  await expect(mount(page).getByText('Last known measurements;', { exact: false })).toBeVisible()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  expect(fixture.writes).toEqual([])
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('lost response never replays and an older confirmed command cannot reconcile this request', async ({ page }) => {
  const fixture = await mountScene(page)
  const previous: Command = { requestId: '77777777-7777-4777-8777-777777777777', action: 'tracking-off', state: 'confirmed', message: 'Tracking is off.' }
  fixture.setMount('off', 'unparked', { ...available, command: previous })
  fixture.handleWrite(route => route.abort('connectionreset'))
  await fixture.open()
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('status')).toContainText('response was lost')
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  await mount(page).getByRole('button', { name: 'Check mount state', exact: true }).click()
  await expect(mount(page).getByRole('status')).toContainText('response was lost')
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.checks).toEqual(fixture.writes)
  fixture.handleCheck(() => fixture.setMount('on', 'unparked', { ...available, trackingOn: off, trackingOff: on,
    command: { ...fixture.writes[0]!, state: 'confirmed', message: 'Tracking is on.' } }))
  await mount(page).getByRole('button', { name: 'Check mount state', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  await expect(mount(page).getByRole('status')).toContainText('Tracking confirmed on.')
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('a request that never reached the server clears only after an explicit admission check', async ({ page }) => {
  const fixture = await mountScene(page)
  fixture.handleWrite(route => route.abort('connectionreset'))
  fixture.setAdmission('not-admitted')
  await fixture.open()
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  await expect(mount(page).getByRole('status')).toContainText('response was lost')
  expect(fixture.checks).toEqual([])
  await mount(page).getByRole('button', { name: 'Check mount state', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeEnabled()
  await expect(mount(page).getByText('Tracking off', { exact: true })).toBeVisible()
  expect(fixture.checks).toEqual(fixture.writes)
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('a restarted server keeps an old uncertain request blocked until explicit reload', async ({ page }) => {
  const fixture = await mountScene(page)
  fixture.handleWrite(route => route.abort('connectionreset'))
  await fixture.open()
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('status')).toContainText('response was lost')
  fixture.setAdmission('unknown')
  fixture.handleCheck(() => fixture.setMount('off', 'unparked', {
    ...available, serverInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }))
  await mount(page).getByRole('button', { name: 'Check mount state', exact: true }).click()
  await expect(mount(page).getByRole('status')).toContainText('cannot establish the previous command’s outcome')
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  expect(fixture.checks).toEqual(fixture.writes)
  await mount(page).getByRole('button', { name: 'Reload Your rig', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeEnabled()
  await expect(mount(page).getByText('Tracking off', { exact: true })).toBeVisible()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('framing prerequisite recovery opens and focuses the mount controls', async ({ page }) => {
  const { scene: explore } = await openExploreScene(page, 'framing-light')
  await page.route('**/api/web/rigs/fra400/framing', route => route.fulfill({ json: {
    ...reviewFraming, active: false, phase: 'needs-check', mountControlReason: 'tracking-off',
    error: 'Mount tracking is off. Turn tracking on in Your rig, then choose Check current frame.',
  } }))
  await page.reload()
  const recovery = page.getByRole('link', { name: 'Mount controls in Your rig →', exact: true })
  await expect(recovery).toBeVisible()
  const equipment = createEquipmentScene('equipment-connected')
  const rig = equipment.snapshot().rig
  equipment.setRig({ ...rig, devices: rig.devices.map(device => device.kind === 'telescope' ? {
    ...device, status: { availability: 'complete', activity: 'idle', tracking: 'off', parking: 'unparked', home: 'away' }, mountControl: available,
  } : device) })
  await page.route('**/api/web/rigs/fra400', route => route.fulfill({ json: equipment.snapshot().rig }))
  await page.reload()
  await expect(recovery).toBeVisible()
  const fixture = await mountScene(page)
  await recovery.click()
  await expect(page).toHaveURL(/\/rigs\/fra400#mount-controls$/)
  await expect(page.locator('#mount-controls')).toBeFocused()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeVisible()
  expect(fixture.writes).toEqual([])
  expect(explore.commands).toEqual([])
  expect(fixture.scene.unknownRequests).toEqual([])
})

for (const mode of ['light', 'dark'] as const) {
  test(`expanded mount controls fit phone and desktop in ${mode}`, async ({ page }, testInfo) => {
    const fixture = await mountScene(page, mode)
    fixture.setMount('off', 'parked', { ...available, unpark: on, trackingOn: off })
    await fixture.open()

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(mount(page).getByRole('button', { name: 'Unpark mount', exact: true })).toBeVisible()
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      await page.screenshot({ path: testInfo.outputPath(`mount-controls-${mode}-${width}.png`), fullPage: true })
    }

    expect(fixture.writes).toEqual([])
    expect(fixture.scene.unknownRequests).toEqual([])
  })
}
