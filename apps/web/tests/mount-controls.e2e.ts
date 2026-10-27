import { expect, test, type Page, type Route } from '@playwright/test'
import type { MountControlView, RigTelescopeDeviceView } from '@vela/model/web'
import { createEquipmentScene } from './fixtures/fieldroom/equipment'
import { openExploreScene, routeQuietAlerts } from './fixtures/fieldroom/browser'
import { reviewFraming } from './fixtures/fieldroom/explore'

const deviceId = 'fra400-mount'

const mountPath = '/api/rigs/fra400/mount'

const on = { enabled: true, reason: null }

const off = { enabled: false, reason: 'The mount state does not permit this action.' }

const serverInstanceId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

const lan = 'http://polaris.test'

// Backstop for the LAN-origin test: the reserved name resolves only to loopback, so nothing leaves this machine.
test.use({ launchOptions: { args: ['--host-resolver-rules=MAP polaris.test 127.0.0.1'] } })

const available: MountControlView = { serverInstanceId, unpark: off, trackingOn: on, trackingOff: off, command: null }

type Command = NonNullable<MountControlView['command']>

type Write = { serverInstanceId: string; deviceId: string; action: Command['action']; requestId: string }

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })

  return { promise, resolve }
}

async function openPanelOn(page: Page) {
  await page.getByRole('button', { name: 'Controls', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible()
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

  const openPanel = () => openPanelOn(page)

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
  // The panel reads capture for its cooler and phone sections; this rig has no camera to offer them.
  await page.route('**/api/web/rigs/fra400/capture', route => route.fulfill({ status: 503, json: { error: 'No capture fixture' } }))
  await routeQuietAlerts(page)

  return {
    scene, writes, checks, setMount,
    setAdmission(value: typeof admission) { admission = value },
    handleCheck(handler: () => void) { handleCheck = handler },
    handleWrite(handler: typeof handleWrite) { handleWrite = handler },
    holdDetail(promise: Promise<void> | null) { holdDetail = promise },
    goto: () => page.goto('/rigs/fra400'),
    openPanel,
    async open() {
      await page.goto('/rigs/fra400')
      await openPanel()
    },
  }
}

function mount(page: Page) {
  return page.getByRole('dialog', { name: 'Controls' }).getByRole('region', { name: 'Mount', exact: true })
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
  fixture.holdDetail(detail.promise)
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turning tracking on…', exact: true })).toBeDisabled()
  await expect(mount(page).getByText('Tracking off · Not parked', { exact: true })).toBeVisible()
  expect(fixture.writes).toEqual([{ serverInstanceId, deviceId, action: 'tracking-on', requestId: expect.stringMatching(/^[0-9a-f-]{36}$/) }])
  const freshRead = page.waitForRequest(request => new URL(request.url()).pathname === '/api/web/rigs/fra400')
  response.resolve()
  await freshRead
  await expect(mount(page).getByRole('button', { name: 'Turning tracking on…', exact: true })).toBeDisabled()
  await expect(mount(page).getByText('Tracking off · Not parked', { exact: true })).toBeVisible()
  fixture.setMount('on', 'unparked', { ...available, trackingOn: off, trackingOff: on, command: { ...fixture.writes[0]!, state: 'confirmed', message: 'Tracking is on.' } })
  detail.resolve()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  await expect(mount(page).getByText('Tracking on · Not parked', { exact: true })).toBeVisible()
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
  await expect(mount(page).getByText('Tracking on · Not parked', { exact: true })).toBeVisible()
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
  await fixture.goto()
  await page.getByRole('button', { name: 'Refresh state', exact: true }).click()
  await expect.poll(() => reads).toBe(2)
  await fixture.openPanel()
  await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  expect(reads).toBe(3)
  oldRead.resolve()
  await oldReadFinished.promise
  await expect(mount(page).getByText('Tracking on · Not parked', { exact: true })).toBeVisible()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test('unknown or interrupted mount observations prevent physical commands', async ({ page }) => {
  const fixture = await mountScene(page)
  fixture.setMount('unknown', 'unknown', { ...available, unpark: off, trackingOn: off, trackingOff: off, command: null })
  await fixture.open()
  await expect(mount(page).getByText('Tracking unknown · Parking unknown', { exact: true })).toBeVisible()
  await expect(mount(page).getByRole('button', { name: 'Unpark mount', exact: true })).toBeDisabled()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeDisabled()
  fixture.setMount('off', 'unparked', available, true)
  await mount(page).getByRole('button', { name: 'Check mount state', exact: true }).click()
  await expect(mount(page).getByText('Current mount state is unavailable.', { exact: false }).first()).toBeVisible()
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
  await expect(mount(page).getByText('Tracking off · Not parked', { exact: true })).toBeVisible()
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
  await mount(page).getByRole('button', { name: 'Reload the page', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Controls' })).toHaveCount(0)
  await fixture.openPanel()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeEnabled()
  await expect(mount(page).getByText('Tracking off · Not parked', { exact: true })).toBeVisible()
  expect(fixture.writes).toHaveLength(1)
  expect(fixture.scene.unknownRequests).toEqual([])
})

test.describe('from a plain-HTTP LAN origin', () => {
  // A phone opens Vela as http://polaris.local:5173, which is not a secure context. Serve the app
  // under the reserved non-loopback name `lan`; every request is answered here.
  test('commands get a request ID, and a refused command frees the control for a new request', async ({ page, baseURL }) => {
    await page.routeWebSocket(/polaris\.test/, socket => socket.close())
    await page.route(`${lan}/**`, async route => {
      const url = new URL(route.request().url())

      await route.fulfill({ response: await route.fetch({ url: `${baseURL}${url.pathname}${url.search}`, headers: {} }) })
    })
    const fixture = await mountScene(page)
    fixture.handleWrite(async (route, body) => {
      if (fixture.writes.length === 1) {
        await route.fulfill({ status: 409, json: { error: 'Another Rig operation is in progress.' } })

        return
      }

      const command: Command = { ...body, state: 'confirmed', message: 'Tracking is on.' }
      fixture.setMount('on', 'unparked', { ...available, trackingOn: off, trackingOff: on, command })
      await route.fulfill({ json: { ...available, trackingOn: off, trackingOff: on, command } })
    })
    await page.goto(`${lan}/rigs/fra400`)
    await fixture.openPanel()
    expect(await page.evaluate(() => ({ origin: location.origin, secure: isSecureContext, randomUUID: 'randomUUID' in crypto })))
      .toEqual({ origin: lan, secure: false, randomUUID: false })

    await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
    await expect(mount(page).getByRole('status')).toContainText('The command was not accepted.')
    expect(fixture.writes).toHaveLength(1)

    // Only a new click sends again, with a new request ID: nothing is replayed.
    await mount(page).getByRole('button', { name: 'Turn tracking on', exact: true }).click()
    await expect(mount(page).getByRole('button', { name: 'Turn tracking off', exact: true })).toBeEnabled()
    await expect(mount(page).getByRole('status')).toContainText('Tracking confirmed on.')

    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    expect(fixture.writes).toEqual([
      { serverInstanceId, deviceId, action: 'tracking-on', requestId: expect.stringMatching(uuid) },
      { serverInstanceId, deviceId, action: 'tracking-on', requestId: expect.stringMatching(uuid) },
    ])
    expect(fixture.writes[0]!.requestId).not.toBe(fixture.writes[1]!.requestId)
    expect(fixture.scene.unknownRequests).toEqual([])
  })
})

test('framing prerequisite recovery opens the Controls panel with the mount section', async ({ page }) => {
  const { scene: explore } = await openExploreScene(page, 'framing-light')
  await page.route('**/api/web/rigs/fra400/framing', route => route.fulfill({ json: {
    ...reviewFraming, active: false, phase: 'needs-check', mountControlReason: 'tracking-off',
    error: 'Mount tracking is off. Turn tracking on in Controls, then choose Check current frame.',
  } }))
  await page.reload()
  const recovery = page.getByRole('button', { name: 'Open Controls →', exact: true })
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
  await expect(page).toHaveURL(/\/rigs\/fra400\/observe\/targets/)
  await expect(page.getByRole('dialog', { name: 'Controls' })).toBeVisible()
  await expect(mount(page).getByRole('button', { name: 'Turn tracking on', exact: true })).toBeVisible()
  expect(fixture.writes).toEqual([])
  expect(explore.commands).toEqual([])
  expect(fixture.scene.unknownRequests).toEqual([])
})

for (const mode of ['light', 'dark'] as const) {
  test(`the mount section fits phone and desktop in ${mode}`, async ({ page }, testInfo) => {
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
