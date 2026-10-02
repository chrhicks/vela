import { expect, test } from '@playwright/test'

function preview(scenario: string, mode = 'light', width = 1280) {
  return `/features/capture-preparation?design=tools-and-readiness&scenario=${scenario}&mode=${mode}&viewport=${width}`
}

test('connecting preserves capture choices and Reset restores the disconnected fixture', async ({ page }) => {
  await page.goto(preview('devices-disconnected'))
  const start = page.getByRole('button', { name: 'Start capture', exact: true })
  const exposure = page.getByRole('spinbutton', { name: 'Exposure time', exact: true })
  await expect(start).toBeDisabled()
  await exposure.fill('45')
  await page.getByRole('checkbox', { name: 'Save every exposure', exact: true }).focus()
  await page.keyboard.press('Space')
  await page.getByRole('button', { name: 'Connect devices', exact: true }).click()
  await expect(page.getByText('Connecting devices…', { exact: true })).toBeVisible()
  await expect(start).toBeDisabled()
  await expect(start).toBeEnabled()
  await expect(exposure).toHaveValue('45')
  await expect(page.getByRole('checkbox', { name: 'Save every exposure', exact: true })).not.toBeChecked()
  await start.click()
  await expect(page.getByRole('dialog', { name: 'Capture preview', exact: true })).toContainText('45 second')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(start).toBeDisabled()
  await expect(exposure).toHaveValue('180')
  await expect(page.getByRole('checkbox', { name: 'Save every exposure', exact: true })).toBeChecked()
})

test('an unconfirmed connection offers inspection without another connection command', async ({ page }) => {
  const apiRequests: string[] = []
  page.on('request', request => {
    if (new URL(request.url()).pathname.startsWith('/api/')) apiRequests.push(request.url())
  })
  await page.goto(preview('connection-unconfirmed'))
  await expect(page.getByRole('button', { name: 'Connect devices', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: 'Check state', exact: true }).click()
  await expect(page.getByText('Checking device state…', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Start capture', exact: true })).toBeEnabled()
  await expect(page.getByText(/earlier command response remains unconfirmed/)).toBeVisible()
  expect(apiRequests).toEqual([])
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(page.getByText('Connection outcome unknown', { exact: true })).toBeVisible()
})

for (const width of [390, 1024, 1280]) {
  for (const mode of ['light', 'dark']) {
    test(`preparation and connection remedy stay usable at ${width}px in ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: width === 390 ? 390 : 1440, height: 1000 })
      await page.goto(preview('devices-disconnected', mode, width))
      await page.evaluate(() => document.fonts.ready)
      const surface = page.locator('.feature-preview-surface')
      await expect(surface).toHaveAttribute('data-mode', mode)
      const bounds = await surface.boundingBox()
      expect(bounds).not.toBeNull()
      const tools = page.getByRole('region', { name: 'Preparation tools', exact: true })
      await expect(tools.getByRole('button', { name: 'Polar alignment →', exact: true })).toBeVisible()
      await tools.getByRole('button', { name: 'Autofocus →', exact: true }).click()
      await expect(page.getByRole('dialog', { name: 'Autofocus', exact: true })).toBeVisible()
      await page.keyboard.press('Escape')
      const connect = page.getByRole('button', { name: 'Connect devices', exact: true })
      await connect.scrollIntoViewIfNeeded()
      const connectBounds = await connect.boundingBox()
      const startBounds = await page.getByRole('button', { name: 'Start capture', exact: true }).boundingBox()
      expect(connectBounds!.x).toBeGreaterThanOrEqual(bounds!.x)
      expect(connectBounds!.x + connectBounds!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1)
      expect(startBounds!.y - (connectBounds!.y + connectBounds!.height)).toBeLessThan(80)
      expect(await page.locator('.prep-preview').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      expect(await page.locator('.prep-preview__capture .vela-field__label').evaluateAll(labels =>
        labels.every(label => label.scrollWidth <= label.clientWidth + 1),
      )).toBe(true)
      expect(await page.locator('.prep-preview__image').evaluate(element =>
        element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
      )).toBe(true)
    })
  }
}
