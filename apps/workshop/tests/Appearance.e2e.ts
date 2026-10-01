import { expect, test } from '@playwright/test'

// Keep behavioral checks independent of the developer's recovered workbench.
test.beforeEach(async ({ page }) => {
  await page.route('**/__workshop/session', route => route.fulfill({ json: { session: null } }))
  await page.route('**/__workshop/profiles', route => route.fulfill({ json: { profiles: [] } }))
})

const specimenUrl = '/?component=appearance&specimen=appearance-primitive&profile=fieldroom&prop.open=false'

test('Appearance selects immediately with arrows and restores its trigger on dismissal', async ({ page }) => {
  await page.goto(specimenUrl)
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Appearance', exact: true })
  const system = panel.getByRole('radio', { name: /System/ })
  await expect(system).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(panel.getByRole('radio', { name: /Light/ })).toBeChecked()
  await expect(panel.getByRole('radio', { name: /Light/ })).toBeFocused()
  await expect(panel).toBeVisible()
  await expect(page).toHaveURL(/prop.preference=light/)
  await page.keyboard.press('ArrowUp')
  await expect(system).toBeChecked()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await trigger.click()
  await panel.getByRole('button', { name: 'Close appearance' }).click()
  await expect(trigger).toBeFocused()
})

test('Appearance has no modal trap and an outside action keeps focus and executes', async ({ page }) => {
  await page.goto(specimenUrl)
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Appearance', exact: true })
  await expect(panel).not.toHaveAttribute('aria-modal', 'true')
  await page.keyboard.press('Tab')
  const outside = page.getByRole('button', { name: 'Outside action', exact: true })
  await expect(outside).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await outside.click()
  await expect(panel).toHaveCount(0)
  await expect(outside).toBeFocused()
  await expect(page.getByText('Outside actions: 1', { exact: true })).toBeVisible()
})

test('phone panel stays in its simulated viewport and reports visit-only preference', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${specimenUrl}&viewport=390&prop.preference=dark&prop.systemMode=dark&prop.persistence=visit`)
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  const panel = page.getByRole('dialog', { name: 'Appearance', exact: true })
  await expect(panel.getByRole('radio', { name: /Dark/ })).toBeFocused()
  await expect(panel.getByText('For this visit only.')).toBeVisible()
  await expect(panel).toHaveCSS('animation-name', 'none')
  const surface = await page.locator('.preview-surface').boundingBox()
  const bounds = await panel.boundingBox()
  expect(bounds!.width).toBe(surface!.width - 40)
  expect(bounds!.x).toBeGreaterThanOrEqual(surface!.x + 20)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(surface!.x + surface!.width - 20)
  await page.keyboard.press('Home')
  await expect(panel.getByRole('radio', { name: /System/ })).toHaveAccessibleName('System Currently dark')
})

test('Fieldroom is the fresh default; exact overrides are editable and can return to a ramp', async ({ page }) => {
  await page.goto('/?component=button&specimen=button-primary')
  await expect(page).toHaveURL(/profile=fieldroom/)
  await expect(page.getByLabel('canvas exact color')).toHaveValue('#f1eee5')
  const exactCanvas = page.locator('.control-field').filter({ has: page.getByLabel('canvas exact color') })
  await exactCanvas.getByRole('button', { name: 'Use generated' }).click()
  await expect(page.getByLabel('canvas exact color')).toHaveCount(0)
  await page.goto('/gallery?profile=fieldroom')
  await expect(page.getByRole('heading', { name: 'Initial primitive library' })).toBeVisible()
  await page.goto('/gallery?profile=vela-current')
  await expect(page.getByRole('heading', { name: 'Initial primitive library' })).toBeVisible()
})

test('Appearance fits above a trigger near the viewport bottom', async ({ page }) => {
  await page.goto(specimenUrl)
  await page.locator('.vela-appearance').evaluate(element => {
    element.style.position = 'fixed'
    element.style.bottom = '20px'
  })
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true })
  await trigger.click()
  const panel = page.getByRole('dialog', { name: 'Appearance', exact: true })
  await expect(panel).toBeVisible()
  const triggerBox = await trigger.boundingBox()
  const panelBox = await panel.boundingBox()
  expect(panelBox!.y).toBeGreaterThanOrEqual(20)
  expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(triggerBox!.y - 4)
})
