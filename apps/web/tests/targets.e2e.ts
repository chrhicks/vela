import { expect, test } from '@playwright/test'
import type { Route } from '@playwright/test'
import type { FramingView, TargetView } from '@vela/model/web'
import { readFileSync } from 'node:fs'

const respond = (route: Route, body: unknown) => {
  // Healthy framing fixtures represent a fresh observation on every response.
  const response = body && typeof body === 'object' && 'phase' in body && 'observedAt' in body
    ? { ...body, observedAt: new Date().toISOString() } : body

  return route.fulfill({ contentType: 'application/json', body: JSON.stringify(response) })
}

const target: TargetView = { id: 'm31', name: 'Andromeda Galaxy', catalog: 'M31', kind: 'Galaxy', raDegrees: 10.6847, decDegrees: 41.269, sizeArcminutes: 178, thumbnailUrl: '/api/targets/m31/thumbnail', sky: null }

const idle: FramingView = { rigId: 'rig-1', rigName: 'Test rig', enabled: true, unavailableReason: null, observedAt: new Date().toISOString(), focalLengthMm: 400, camera: { name: 'Test camera', width: 3000, height: 2000, fieldWidthDegrees: 3, fieldHeightDegrees: 2 }, phase: 'idle', active: false, desired: null, targetId: null, actual: null, error: null, exposureSeconds: 2, canCenter: false, checkCurrent: false }

const allsky = readFileSync(new URL('./fixtures/survey-allsky.jpg', import.meta.url))

const tile = readFileSync(new URL('./fixtures/survey-tile.jpg', import.meta.url))

test('an untouched target and Reset frame send only the accepted slew fields', async ({ page }) => {
  let state = { ...idle }
  const submissions: unknown[] = []
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, state))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/rigs/rig-1/framing/start', route => {
    const body = route.request().postDataJSON()
    submissions.push(body)

    if (Object.keys(body).sort().join(',') !== 'decDegrees,exposureSeconds,raDegrees,targetId') {
      return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'Invalid framing command body' }) })
    }

    state = { ...state, targetId: body.targetId, desired: { raDegrees: body.raDegrees, decDegrees: body.decDegrees },
      phase: 'checked', checkCurrent: true, actual: { raDegrees: body.raDegrees, decDegrees: body.decDegrees,
        checkId: `check-${submissions.length}`, capturedAt: new Date().toISOString(), rotationDegrees: 0, offsetArcminutes: 0,
        corners: [{ raDegrees: 9, decDegrees: 40 }, { raDegrees: 11, decDegrees: 40 }, { raDegrees: 11, decDegrees: 42 }, { raDegrees: 9, decDegrees: 42 }] } }

    return respond(route, state)
  })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await page.getByRole('button', { name: 'Slew & check' }).click()
  await expect(page.getByText('Framing checked', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Adjust composition' }).click()
  await page.getByRole('button', { name: 'Move frame →' }).click()
  await page.getByRole('button', { name: 'Reset frame' }).click()
  await page.getByRole('button', { name: 'Slew & check' }).click()
  await expect(page.getByText('Framing checked', { exact: true })).toBeVisible()
  expect(submissions).toEqual(Array(2).fill({ targetId: target.id, raDegrees: target.raDegrees, decDegrees: target.decDegrees, exposureSeconds: 2 }))
})

test('catalog is paged and search updates use actual server results; missing site and image stay honest on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const queries: string[] = []
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', route => {
    queries.push(route.request().url())
    const params = new URL(route.request().url()).searchParams

    return respond(route, { rigId: 'rig-1', rigName: 'Test rig', snapshotId: 'catalog-test', calculatedAt: new Date().toISOString(), status: 'site-unavailable', night: null, query: params.get('q') ?? '', category: params.get('category') ?? 'all', filter: params.get('filter') ?? 'all', offset: Number(params.get('offset')), pageSize: 24, targets: [{ ...target, category: 'galaxy', filterChoice: 'broadband', filterReason: 'Broadband preserves starlight.', opportunity: null }], total: 25, site: null, siteUnavailableReason: 'Mount site is unavailable.' })
  })
  await page.route('**/api/targets/*/thumbnail', route => route.abort())
  await page.goto('/rigs/rig-1/observe/targets')
  await expect(page.getByRole('heading', { name: target.name })).toBeVisible()
  await expect(page.getByText('Reference image unavailable')).toBeVisible()
  await expect(page.getByText('The mount’s site could not be read: Mount site is unavailable.')).toBeVisible()
  await page.getByRole('button', { name: 'Next', exact: true }).click()
  await expect.poll(() => queries.some(q => q.includes('offset=24'))).toBe(true)
  await page.getByLabel('Find a target').fill('M31')
  await expect.poll(() => queries.some(q => new URL(q).searchParams.get('q') === 'M31' && new URL(q).searchParams.get('offset') === '0')).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('ambiguous command is not repeated and requires explicit current state check', async ({ page }) => {
  let commands = 0
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, idle))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/rigs/rig-1/framing/start', route => { commands++;

 return route.abort() })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeEnabled()
  await page.getByRole('button', { name: 'Slew & check' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be confirmed')
  await expect(page.getByText('Check rig state before continuing', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeDisabled()
  await page.waitForTimeout(1200)
  expect(commands).toBe(1)
  await page.getByRole('button', { name: 'Check rig state' }).click()
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeEnabled()
  await expect(page.getByText('Reference survey unavailable')).toBeVisible()
})

test('survey footprint uses projected coordinates and keyboard adjustment; tile requests stay same-origin', async ({ page }) => {
  const errors: string[] = [], external: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  page.on('request', request => { if (request.url().startsWith('http') && !request.url().startsWith('http://127.0.0.1:5175')) external.push(request.url()) })
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, idle))
  await page.route('**/api/survey/dss2/**', route => route.request().url().endsWith('/properties') ? route.fulfill({ contentType: 'text/plain', body: 'dataproduct_type=image\nhips_order=9\nhips_tile_width=512\nhips_frame=equatorial\nhips_tile_format=jpeg\n' }) : route.fulfill({ contentType: 'image/jpeg', body: route.request().url().endsWith('Allsky.jpg') ? allsky : tile }))
  await page.goto('/rigs/rig-1/observe/targets/m31')
  const frame = page.getByRole('slider', { name: 'Camera frame position' })
  await expect(frame).toBeVisible({ timeout: 30000 })
  const original = await frame.getAttribute('points')
  await frame.focus()
  await page.keyboard.press('ArrowRight')
  await expect(frame).not.toHaveAttribute('points', original!)
  await expect(frame).not.toHaveAttribute('aria-valuetext', 'RA 10.6847, Dec 41.2690 degrees')
  const positionBeforeZoom = await frame.getAttribute('aria-valuetext')
  const pointsBeforeZoom = await frame.getAttribute('points')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(frame).not.toHaveAttribute('points', pointsBeforeZoom!)
  await expect(frame).toHaveAttribute('aria-valuetext', positionBeforeZoom!)
  await frame.hover()
  const pointsBeforeWheel = await frame.getAttribute('points')
  const scrollBeforeWheel = await page.evaluate(() => window.scrollY)
  await page.mouse.wheel(0, -200)
  await expect(frame).not.toHaveAttribute('points', pointsBeforeWheel!)
  await expect(frame).toHaveAttribute('aria-valuetext', positionBeforeZoom!)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrollBeforeWheel)
  const box = (await frame.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 })
  await page.mouse.up()
  await expect(frame).not.toHaveAttribute('aria-valuetext', positionBeforeZoom!)
  const positionBeforePan = await frame.getAttribute('aria-valuetext')
  const pointsBeforePan = await frame.getAttribute('points')
  const field = (await page.locator('.vela-target-field').boundingBox())!
  await page.mouse.move(field.x + 15, field.y + 15)
  await page.mouse.down()
  await page.mouse.move(field.x + 45, field.y + 35, { steps: 5 })
  await page.mouse.up()
  await expect(frame).not.toHaveAttribute('points', pointsBeforePan!)
  await expect(frame).toHaveAttribute('aria-valuetext', positionBeforePan!)
  expect(errors).toEqual([])
  expect(external).toEqual([])
})

test('checked framing offers one correction, active operations lock edits, and stale state blocks commands', async ({ page }) => {
  let state: FramingView = { ...idle, phase: 'checked', checkCurrent: true, desired: target, targetId: target.id, canCenter: true, actual: { ...target, checkId: 'displayed-check', capturedAt: new Date().toISOString(), rotationDegrees: 32, offsetArcminutes: 2.4, corners: [{ raDegrees: 9, decDegrees: 40 }, { raDegrees: 11, decDegrees: 40 }, { raDegrees: 11, decDegrees: 42 }, { raDegrees: 9, decDegrees: 42 }] } }
  let offline = false, corrections = 0, stops = 0
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => offline ? route.abort() : respond(route, state))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/rigs/rig-1/framing/center', route => { expect(route.request().postDataJSON()).toEqual({ checkId: 'displayed-check' }); corrections++; state = { ...state, phase: 'slewing', active: true, canCenter: false, checkCurrent: false };

 return respond(route, state) })
  await page.route('**/api/rigs/rig-1/framing/stop', route => { stops++; state = { ...state, phase: 'stopped', active: false };

 return respond(route, state) })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeVisible()
  await page.getByRole('button', { name: 'Center & recheck' }).click()
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeEnabled()
  await expect(page.getByRole('button', { name: 'Reset frame' })).toBeDisabled()
  expect(corrections).toBe(1)
  offline = true
  await expect(page.getByText('Connection interrupted · last known state')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeDisabled()
  await expect(page.getByText('Last check offset: 2.40′.', { exact: false })).toBeVisible()
  offline = false
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeEnabled()
  await page.getByRole('button', { name: 'Stop framing' }).click()
  await expect(page.getByText('Framing stopped', { exact: true })).toBeVisible()
  expect(stops).toBe(1)
  expect(corrections).toBe(1)
})

test('a rejected adjusted composition cannot inherit the prior framing check after recovery', async ({ page }) => {
  let state: FramingView = { ...idle, phase: 'checked', checkCurrent: true, desired: target, targetId: target.id, canCenter: true }
  let rejectStart = true, commands = 0
  let submitted: { raDegrees: number, decDegrees: number } | null = null
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, { ...state, observedAt: new Date().toISOString() }))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/rigs/rig-1/framing/start', route => {
    commands++
    submitted = route.request().postDataJSON()

    if (rejectStart) return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Camera identity changed before framing.' }) })
    state = { ...state, desired: submitted, phase: 'slewing', active: true, checkCurrent: false, observedAt: new Date().toISOString() }

    return respond(route, state)
  })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeVisible()
  await page.getByRole('button', { name: 'Adjust composition' }).click()
  await page.getByRole('button', { name: 'Move frame →' }).click()
  const composition = page.locator('.vela-target-details').filter({ hasText: 'Center (J2000)' })
  const editedCoordinates = (await composition.textContent())!
  await expect(page.getByText('Composition not checked', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Slew & check' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be confirmed')
  await expect(page.getByRole('alert')).toContainText('Camera identity changed before framing.')
  await page.getByRole('button', { name: 'Check rig state' }).click()
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeEnabled()
  await expect(composition).toHaveText(editedCoordinates)
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toHaveCount(0)
  await expect(page.getByText('Framing checked', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Composition not checked', { exact: true })).toBeVisible()
  expect(commands).toBe(1)
  expect(submitted?.raDegrees).not.toBe(target.raDegrees)
  rejectStart = false
  await page.getByRole('button', { name: 'Slew & check' }).click()
  await expect(page.getByRole('button', { name: 'Stop framing' })).toBeVisible()
  state = { ...state, phase: 'checked', active: false, checkCurrent: true }
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeVisible()
  expect(commands).toBe(2)
})

test('an explicit read recovers a completed adjusted check after its command response is lost', async ({ page }) => {
  let state: FramingView = { ...idle, phase: 'checked', checkCurrent: true, desired: target, targetId: target.id }
  let commands = 0
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, { ...state, observedAt: new Date().toISOString() }))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/rigs/rig-1/framing/start', route => {
    commands++
    const input = route.request().postDataJSON()
    state = { ...state, desired: { raDegrees: input.raDegrees, decDegrees: input.decDegrees } }

    return route.abort()
  })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeVisible()
  await page.getByRole('button', { name: 'Adjust composition' }).click()
  await page.getByRole('button', { name: 'Move frame →' }).click()
  await page.getByRole('button', { name: 'Slew & check' }).click()
  await expect(page.getByRole('alert')).toContainText('could not be confirmed')
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Check rig state' }).click()
  await expect(page.getByText('Framing checked', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeVisible()
  expect(commands).toBe(1)
})

for (const failureSource of ['command', 'poll'] as const) {
  test(`precise framing error remains visible alongside recovery guidance after ${failureSource} failure`, async ({ page }) => {
    let state: FramingView = { ...idle, targetId: target.id, desired: target, phase: 'slewing', active: true }
    const failed: FramingView = { ...state, phase: 'failed', active: false, error: 'Telescope stop could not be confirmed' }
    await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
    await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, { ...state, observedAt: new Date().toISOString() }))
    await page.route('**/api/survey/**', route => route.abort())
    await page.route('**/api/rigs/rig-1/framing/stop', route => { state = failed;

 return respond(route, { ...state, observedAt: new Date().toISOString() }) })
    await page.goto('/rigs/rig-1/observe/targets/m31')
    await expect(page.getByRole('button', { name: 'Stop framing' })).toBeEnabled()

    if (failureSource === 'command') await page.getByRole('button', { name: 'Stop framing' }).click()
    else state = failed
    await expect(page.getByRole('alert').filter({ hasText: 'Telescope stop could not be confirmed' })).toBeVisible()
    await expect(page.getByRole('alert').filter({ hasText: 'Inspect the reported state' })).toBeVisible()
    await page.getByRole('button', { name: 'Check rig state' }).click()
    await expect(page.getByRole('button', { name: 'Slew & check' })).toBeEnabled()
    await expect(page.getByRole('alert').filter({ hasText: 'Telescope stop could not be confirmed' })).toBeVisible()
  })
}

test('quiet polling leaves Check rig state enabled and an explicit check supersedes a slow poll', async ({ page }) => {
  let reads = 0
  let armed = false
  let releasePoll!: () => void
  let releaseCheck!: () => void
  const pollHeld = new Promise<void>(resolve => { releasePoll = resolve })
  const checkHeld = new Promise<void>(resolve => { releaseCheck = resolve })
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/survey/**', route => route.abort())
  await page.route('**/api/web/rigs/rig-1/framing', async route => {
    const read = armed ? ++reads : 0

    if (read === 1) await pollHeld

    if (read === 2) await checkHeld
    await respond(route, { ...idle, observedAt: new Date().toISOString() })
  })
  await page.goto('/rigs/rig-1/observe/targets/m31')
  const check = page.getByRole('button', { name: 'Check rig state' })
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeEnabled()
  armed = true
  await expect.poll(() => reads).toBe(1)
  await expect(check).toBeEnabled()
  await check.click()
  await expect.poll(() => reads).toBe(2)
  await expect(check).toBeDisabled()
  releasePoll()
  await expect(check).toBeDisabled()
  releaseCheck()
  await expect(check).toBeEnabled()
})

test('Targets breadcrumb preserves search and results page through a detail reload', async ({ page }) => {
  const queries: string[] = []
  await page.route('**/api/web/rigs/rig-1/target-discovery?*', route => {
    queries.push(route.request().url())

    return respond(route, { rigId: 'rig-1', rigName: 'Test rig', snapshotId: 'breadcrumb-night', calculatedAt: '2026-09-08T02:00:00.000Z', status: 'site-unavailable', night: null, query: 'galaxy', category: 'all', filter: 'all', offset: 24, pageSize: 12, targets: [{ ...target, category: 'galaxy', filterChoice: 'broadband', filterReason: 'Broadband preserves starlight.', opportunity: null }], total: 49, site: null, siteUnavailableReason: 'Site unavailable' })
  })
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => respond(route, idle))
  await page.route('**/api/targets/*/thumbnail', route => route.abort())
  await page.route('**/api/survey/**', route => route.abort())
  await page.goto('/rigs/rig-1/observe/targets?q=galaxy&offset=24')
  await expect(page.getByLabel('Find a target')).toHaveValue('galaxy')
  await page.getByRole('link', { name: 'Explore target', exact: true }).click()
  await expect(page).toHaveURL(/targets\/m31\?/)
  await page.reload()
  await page.getByRole('link', { name: '← Targets', exact: true }).click()
  expect(new URL(page.url()).searchParams.get('q')).toBe('galaxy')
  expect(new URL(page.url()).searchParams.get('offset')).toBe('24')
  await expect(page.getByLabel('Find a target')).toHaveValue('galaxy')
  await expect(page.getByText('25–36 of 49')).toBeVisible()
  expect(new URL(queries.at(-1)!).searchParams.get('q')).toBe('galaxy')
  expect(new URL(queries.at(-1)!).searchParams.get('offset')).toBe('24')
})

test('failure recovery preserves local drag, zoom and nudges while device commands remain blocked', async ({ page }) => {
  let state: FramingView = { ...idle, active: true, phase: 'slewing', targetId: target.id, desired: target }
  let commands = 0
  let offline = false
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => respond(route, target))
  await page.route('**/api/web/rigs/rig-1/framing', route => offline ? route.abort() : respond(route, state))
  await page.route('**/api/rigs/rig-1/framing/*', route => { commands++;

 return route.abort() })
  await page.route('**/api/survey/dss2/**', route => route.request().url().endsWith('/properties') ? route.fulfill({ contentType: 'text/plain', body: 'dataproduct_type=image\nhips_order=9\nhips_tile_width=512\nhips_frame=equatorial\nhips_tile_format=jpeg\n' }) : route.fulfill({ contentType: 'image/jpeg', body: route.request().url().endsWith('Allsky.jpg') ? allsky : tile }))
  await page.goto('/rigs/rig-1/observe/targets/m31')
  const frame = page.getByRole('slider', { name: 'Camera frame position' })
  await expect(frame).toBeVisible()
  await expect(frame).toHaveAttribute('aria-disabled', 'true')
  await expect(page.getByText('Framing in progress · editing paused')).toBeVisible()
  const initial = await frame.getAttribute('aria-valuetext')
  state = { ...state, active: false, phase: 'failed', error: 'Telescope tracking change was not confirmed' }
  await expect(page.getByRole('alert').filter({ hasText: 'Inspect the reported state' })).toBeVisible()
  await expect(frame).toHaveAttribute('aria-disabled', 'false')
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeDisabled()
  await page.getByText('Optics settings', { exact: true }).click()
  await expect(page.getByRole('button', { name: 'Save focal length' })).toBeDisabled()
  const before = (await frame.boundingBox())!
  const centerBefore = (await page.locator('.vela-target-cross').boundingBox())!
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
  await page.mouse.down()
  await page.mouse.move(before.x + before.width / 2 + 30, before.y + before.height / 2 + 20, { steps: 5 })
  await page.mouse.up()
  await expect(frame).not.toHaveAttribute('aria-valuetext', initial!)
  const centerAfter = (await page.locator('.vela-target-cross').boundingBox())!
  expect(centerAfter.x - centerBefore.x).toBeCloseTo(30, 0)
  expect(centerAfter.y - centerBefore.y).toBeCloseTo(20, 0)
  const moved = await frame.getAttribute('aria-valuetext')
  const points = await frame.getAttribute('points')
  await frame.hover()
  await page.mouse.wheel(0, -200)
  await expect(frame).not.toHaveAttribute('points', points!)
  await expect(frame).toHaveAttribute('aria-valuetext', moved!)
  await page.getByRole('button', { name: 'Move frame →' }).click()
  await expect(frame).not.toHaveAttribute('aria-valuetext', moved!)
  await page.getByRole('button', { name: 'Reset frame' }).click()
  await expect(frame).toHaveAttribute('aria-valuetext', initial!)
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeDisabled()
  expect(commands).toBe(0)
  offline = true
  await expect(page.getByText('Connection interrupted · last known state')).toBeVisible()
  await page.getByRole('button', { name: 'Move frame →' }).click()
  await expect(frame).not.toHaveAttribute('aria-valuetext', initial!)
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeDisabled()
  offline = false
  await page.getByRole('button', { name: 'Check rig state' }).click()
  await expect(page.getByRole('button', { name: 'Slew & check' })).toBeEnabled()
  expect(commands).toBe(0)
})
