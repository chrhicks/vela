import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

function inspectorSelect(page: Page, label: string) {
  return page.locator('.control-field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator('select')
}

test('Start Observing enters the workspace without skipping readiness', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=rig&prop.rig=seestar&prop.state=disconnected')

  await expect(page.getByRole('heading', { level: 1, name: 'Seestar S30' })).toBeVisible()
  await page.getByRole('button', { name: 'Start observing' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'Observing with Seestar S30' })).toBeVisible()
  await expect(page.getByText('Connect this Rig’s devices', { exact: true })).toBeVisible()
  await expect(inspectorSelect(page, 'Screen')).toHaveValue('observe')
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('disconnected')
})

test('connection progress is one operation and settles as ready', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=observe&prop.rig=seestar&prop.state=disconnected')

  await page.getByRole('button', { name: 'Connect devices' }).click()

  const connecting = page.getByRole('button', { name: 'Connecting devices…' })
  const readinessStatus = page.locator('.vela-observe-readiness [role="status"]')
  await expect(connecting).toBeDisabled()
  await expect(readinessStatus).toContainText('Vela is asking the Rig to connect')
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('connecting')

  const readyHeading = page.getByRole('heading', { level: 3, name: 'This Rig is ready' })
  await expect(readyHeading).toBeVisible()
  await expect(readinessStatus).toContainText('Every device is connected')
  await expect(readyHeading).toBeFocused()
  await expect(readyHeading).toHaveCSS('outline-style', 'solid')
  await expect(readyHeading).toHaveCSS('outline-width', '2px')
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('ready')
})

test('Rig details keeps device progress neutral while the sequential operation runs', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=observe&prop.rig=seestar&prop.state=disconnected')

  await page.getByRole('button', { name: 'Connect devices' }).click()
  await page.getByRole('button', { name: 'Rig details' }).click()

  const deviceStatuses = page.locator('.vela-observation-equipment__status strong')
  await expect(deviceStatuses).toHaveText(['Status updating', 'Status updating', 'Status updating'])
  await expect(page.getByText('Connecting', { exact: true })).toHaveCount(0)
})

test('readiness remains truthful when returning through Rig details', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=observe&prop.rig=seestar&prop.state=ready')

  await page.getByRole('button', { name: 'Rig details' }).click()
  await expect(page.getByText('5 of 5 devices connected', { exact: true })).toBeVisible()
  await expect(page.locator('.vela-observation-equipment__status').first()).toContainText('Connected')
  await page.getByRole('button', { name: 'Start observing' }).click()

  await expect(page.getByText('This Rig is ready', { exact: true })).toBeVisible()
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('ready')
})

test('Askar interrupted outcomes refer only to its own equipment', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=observe&prop.rig=askar&prop.state=partial')

  await expect(page.getByText('Guide camera', { exact: true })).toBeVisible()
  await expect(page.getByText('Filter wheel', { exact: true })).toHaveCount(0)
  await inspectorSelect(page, 'Readiness').selectOption('uncertain')
  await expect(page.getByText('Guide camera', { exact: true })).toBeVisible()
  await expect(page.getByText('Filter wheel', { exact: true })).toHaveCount(0)
  await expect(page.getByText('2 confirmed connected', { exact: true })).toBeVisible()
  await inspectorSelect(page, 'Screen').selectOption('rig')
  await expect(page.getByText('2 confirmed connected', { exact: true })).toBeVisible()
})

test('an abandoned connection preview cannot overwrite a newer uncertain state', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=observe&prop.rig=seestar&prop.state=disconnected')

  await page.getByRole('button', { name: 'Connect devices' }).click()
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('connecting')
  await inspectorSelect(page, 'Readiness').selectOption('uncertain')
  await page.waitForTimeout(1_300)

  await expect(page.getByText('The connection result is uncertain', { exact: true })).toBeVisible()
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('uncertain')
})

test('a pending connection cannot settle against a newly selected Rig', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&prop.screen=observe&prop.rig=seestar&prop.state=disconnected')

  await page.getByRole('button', { name: 'Connect devices' }).click()
  await inspectorSelect(page, 'Rig').selectOption('askar')
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('ready')
  await inspectorSelect(page, 'Readiness').selectOption('uncertain')
  await page.waitForTimeout(1_300)

  await expect(page.getByText('Guide camera', { exact: true })).toBeVisible()
  await expect(inspectorSelect(page, 'Readiness')).toHaveValue('uncertain')
})

test('phone composition keeps readiness and its action within the preview', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-observation-readiness&viewport=390&prop.screen=observe&prop.rig=seestar&prop.state=disconnected')

  const preview = page.locator('.vela-observation-demo')
  const readiness = page.locator('.vela-observe-readiness')
  const action = page.getByRole('button', { name: 'Connect devices' })
  await expect(preview).toBeVisible()
  await expect(action).toBeVisible()

  const previewBox = await preview.boundingBox()
  const readinessBox = await readiness.boundingBox()
  const actionBox = await action.boundingBox()
  expect(previewBox).not.toBeNull()
  expect(readinessBox).not.toBeNull()
  expect(actionBox).not.toBeNull()
  expect(readinessBox!.x).toBeGreaterThanOrEqual(previewBox!.x)
  expect(readinessBox!.x + readinessBox!.width).toBeLessThanOrEqual(previewBox!.x + previewBox!.width)
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(previewBox!.x + previewBox!.width)
})
