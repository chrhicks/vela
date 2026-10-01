import { expect, test } from '@playwright/test'

test('observed switch has source geometry and keyboard operation', async ({ page }) => {
  await page.goto('/?component=switch&specimen=observed-setting&profile=fieldroom&mode=light')
  const control = page.getByRole('switch', { name: 'Cooler on' })
  await expect(control).toBeChecked()
  await control.focus()
  await page.keyboard.press('Space')
  await expect(control).not.toBeChecked()
  await page.keyboard.press('Enter')
  await expect(control).toBeChecked()
  expect(await control.boundingBox()).toMatchObject({ width: 44, height: 44 })
  expect(await control.locator('.vela-switch__track').boundingBox()).toMatchObject({ width: 40, height: 24 })
  await page.screenshot({ path: '/tmp/vela-switch-workshop-light.png' })
})

test('pending keeps its observed value and focus without requesting another change', async ({ page }) => {
  await page.goto('/?component=switch&specimen=observed-setting&profile=fieldroom&mode=dark&prop.pending=true')
  const control = page.getByRole('switch', { name: 'Cooler on' })
  await expect(control).toHaveAttribute('aria-busy', 'true')
  await control.focus()
  await page.keyboard.press('Space')
  await expect(control).toBeChecked()
  await expect(control).toBeFocused()
  await page.screenshot({ path: '/tmp/vela-switch-workshop-dark.png' })
})
