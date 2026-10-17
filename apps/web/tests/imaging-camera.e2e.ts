import { expect, test } from '@playwright/test'
import { openEquipmentScene } from './fixtures/fieldroom/browser'
import { reviewTimezone } from './fixtures/fieldroom/tonight'

test.use({ timezoneId: reviewTimezone })

const readPath = '/api/web/rigs/fra400/imaging-camera'

test('Imaging setup keeps the confirmed camera when a read from before the save arrives late', async ({
  page,
}) => {
  // Exercise the generation guard even when cancelling transport loses the race.
  await page.addInitScript(() => {
    const original = window.fetch
    window.fetch = (input, init) =>
      String(input).includes('/api/web/rigs/fra400/imaging-camera')
        ? original(input, { ...init, signal: null })
        : original(input, init)
  })
  const { scene } = await openEquipmentScene(page, 'equipment-setup-save')
  let hold = false
  let held = false
  let released = false
  let release!: () => void

  const waiting = new Promise<void>(resolve => {
    release = resolve
  })

  await page.route(`**${readPath}`, async route => {
    const snapshot = scene.respond('GET', readPath)
    const delayed = hold && !held

    if (delayed) {
      held = true
      await waiting
    }

    await route.fulfill({ status: snapshot.status, json: snapshot.json })

    if (delayed) released = true
  })
  const camera = page.getByRole('combobox', { name: 'Imaging camera', exact: true })
  await expect(camera).toHaveValue('camera')
  hold = true
  await expect.poll(() => held, { timeout: 15_000 }).toBe(true)
  await camera.selectOption('other-camera')
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect.poll(() => scene.writes.length).toBe(1)
  await expect(camera).toBeEnabled()
  release()
  await expect.poll(() => released).toBe(true)
  await expect(camera).toHaveValue('other-camera')
  await page.getByRole('button', { name: 'Save imaging setup', exact: true }).click()
  await expect(page.getByText('Imaging setup is already saved.', { exact: true })).toBeVisible()
  expect(scene.writes).toEqual([
    { method: 'PUT', pathname: '/api/rigs/fra400/imaging-camera', body: { id: 'other-camera', name: 'ZWO ASI220MM Mini' } },
  ])
})

test('Imaging setup keeps the saved camera through failed reads and asks for a choice after an identity change', async ({
  page,
}) => {
  const { scene } = await openEquipmentScene(page, 'equipment-connected')
  let offline = false
  await page.route(`**${readPath}`, route => {
    if (offline) return route.abort()
    const result = scene.respond('GET', readPath)

    return route.fulfill({ status: result.status, json: result.json })
  })
  const camera = page.getByRole('combobox', { name: 'Imaging camera', exact: true })
  await expect(camera).toHaveValue('camera')
  offline = true
  await expect(page.getByText('Setup updates are interrupted.', { exact: false })).toBeVisible({ timeout: 15_000 })
  await expect(camera).toHaveValue('camera')
  const saved = scene.snapshot().camera
  scene.setCamera({
    ...saved,
    state: 'changed',
    selectedDeviceId: null,
    cameras: saved.cameras.map(choice => choice.id === 'camera' ? { ...choice, name: 'Replacement camera' } : choice),
  })
  offline = false
  await expect(page.getByText('The saved camera slot now reports a different camera.', { exact: false })).toBeVisible({ timeout: 15_000 })
  expect(scene.writes).toEqual([])
})
