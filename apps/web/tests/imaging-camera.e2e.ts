import { expect, test, type Page, type Route } from '@playwright/test'
import type { ImagingCameraView } from '@vela/model/web'
import { observation } from './fixtures/observation'

const respond = <Body>(route: Route, body: Body) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) })

const cameras = [
  { id: 'main', name: 'ZWO ASI2600MC Pro', configuredName: 'ASI Camera (1)' },
  { id: 'guide', name: 'ZWO ASI220MM Mini', configuredName: 'ASI Camera (2)' },
]

const empty: ImagingCameraView = { rigId: 'rig-1', selected: null, cameras, state: 'unselected', editable: true }

const saved: ImagingCameraView = { ...empty, selected: { id: 'main', name: cameras[0]!.name }, state: 'ready' }

async function observe(page: Page) {
  await page.route('**/api/web/rigs/rig-1/observe', route => respond(route, observation('complete')))
  await page.route('**/api/web/rigs/rig-1/capture', route => respond(route, {
    rigId: 'rig-1', rigName: 'Seestar S30', camera: null, enabled: false,
    unavailableReason: 'Choose an imaging camera.', phase: 'idle', active: false,
    exposureSeconds: 2, elapsedSeconds: 0, error: null, latestImage: null,
  }))
  await page.goto('/rigs/rig-1/observe')
}

test('remembers the server-confirmed choice after reload and rejects a late pre-save poll', async ({ page }) => {
  // Exercise the generation guard even when cancelling transport loses the race.
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = (input, init) => String(input).includes('/api/web/rigs/rig-1/imaging-camera')
      ? original(input, { ...init, signal: null }) : original(input, init)
  })
  let current = empty
  let writes = 0
  let hold = false
  let held = false
  let released = false
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/web/rigs/rig-1/imaging-camera', async route => {
    const snapshot = current
    const delayed = hold && !held

    if (delayed) { held = true; await waiting }

    await respond(route, snapshot)

    if (delayed) released = true
  })
  let finish!: () => void
  const saving = new Promise<void>(resolve => { finish = resolve })
  await page.route('**/api/rigs/rig-1/imaging-camera', async route => {
    writes++
    expect(route.request().postDataJSON()).toEqual(saved.selected)
    await saving
    current = saved
    await respond(route, current)
  })
  await observe(page)
  const panel = page.getByRole('region', { name: 'Imaging camera', exact: true })
  await panel.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('main')
  hold = true
  await expect.poll(() => held).toBe(true)
  await panel.getByRole('button', { name: 'Use this camera' }).click()
  await expect(panel.getByRole('button', { name: 'Saving camera…' })).toBeDisabled()
  finish()
  await expect(panel.getByRole('button', { name: 'Change', exact: true })).toBeEnabled()
  release()
  await expect.poll(() => released).toBe(true)
  await expect(panel.getByText('ZWO ASI2600MC Pro', { exact: true })).toBeVisible()
  await expect(panel.getByRole('combobox', { name: 'Camera', exact: true })).toHaveCount(0)
  await page.reload()
  await expect(panel.getByRole('button', { name: 'Change', exact: true })).toBeEnabled()
  await expect(panel.getByText('ZWO ASI2600MC Pro', { exact: true })).toBeVisible()
  expect(writes).toBe(1)
})

test('retains the saved camera offline and requires an explicit choice for changed identity', async ({ page }) => {
  let current = saved
  let offline = false
  await page.route('**/api/web/rigs/rig-1/imaging-camera', route => offline ? route.abort() : respond(route, current))
  await observe(page)
  const panel = page.getByRole('region', { name: 'Imaging camera', exact: true })
  await expect(panel.getByRole('button', { name: 'Change', exact: true })).toBeEnabled()
  offline = true
  await expect(panel.getByText(/Rig updates are interrupted/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Change', exact: true })).toBeDisabled()
  await expect(panel.getByText('ZWO ASI2600MC Pro', { exact: true })).toBeVisible()
  current = { ...saved, state: 'changed', cameras: [{ ...cameras[0]!, name: 'Replacement camera' }] }
  offline = false
  await expect(panel.getByText(/now reports a different camera/)).toBeVisible()
  await panel.getByRole('button', { name: 'Change', exact: true }).click()
  await expect(panel.getByRole('button', { name: 'Use this camera' })).toBeDisabled()
  await panel.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('main')
  await expect(panel.getByRole('button', { name: 'Use this camera' })).toBeEnabled()
})

test('reconciles a lost save response from persisted selection without replaying the write', async ({ page }) => {
  let current = empty
  let writes = 0
  let check = false
  let release!: () => void
  const waiting = new Promise<void>(resolve => { release = resolve })
  await page.route('**/api/web/rigs/rig-1/imaging-camera', async route => {
    if (writes) { check = true; await waiting }

    await respond(route, current)
  })
  await page.route('**/api/rigs/rig-1/imaging-camera', async route => {
    writes++
    current = saved
    await route.abort()
  })
  await observe(page)
  const panel = page.getByRole('region', { name: 'Imaging camera', exact: true })
  await panel.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('main')
  await panel.getByRole('button', { name: 'Use this camera' }).click()
  await expect.poll(() => check).toBe(true)
  await expect(panel.getByText(/save response could not be confirmed/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Use this camera' })).toBeDisabled()
  release()
  await expect(panel.getByRole('button', { name: 'Change', exact: true })).toBeEnabled()
  await expect(panel.getByText(/save response could not be confirmed/)).toHaveCount(0)
  expect(writes).toBe(1)
})

test('an explicit check unlocks an unsaved uncertain choice without replaying it', async ({ page }) => {
  let current = empty
  let writes = 0
  await page.route('**/api/web/rigs/rig-1/imaging-camera', route => respond(route, current))
  await page.route('**/api/rigs/rig-1/imaging-camera', async route => {
    writes++

    if (writes === 1) await route.abort()
    else { current = saved; await respond(route, current) }
  })
  await observe(page)
  const panel = page.getByRole('region', { name: 'Imaging camera', exact: true })
  await panel.getByRole('combobox', { name: 'Camera', exact: true }).selectOption('main')
  await panel.getByRole('button', { name: 'Use this camera' }).click()
  await expect(panel.getByText(/save response could not be confirmed/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Use this camera' })).toBeDisabled()
  current = { ...empty, editable: false }
  await panel.getByRole('button', { name: 'Check saved camera' }).click()
  await expect(panel.getByText(/Another rig operation/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Use this camera' })).toBeDisabled()
  current = empty
  await panel.getByRole('button', { name: 'Check saved camera' }).click()
  await expect(panel.getByText(/requested camera is not the saved selection/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Use this camera' })).toBeEnabled()
  expect(writes).toBe(1)
  await panel.getByRole('button', { name: 'Use this camera' }).click()
  await expect(panel.getByRole('button', { name: 'Change', exact: true })).toBeEnabled()
  expect(writes).toBe(2)
})
