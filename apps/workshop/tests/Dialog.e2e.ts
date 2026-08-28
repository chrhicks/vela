import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

// Modal previews intentionally make the workshop inspector inert. These helpers simulate
// external session edits without weakening Dialog modality just for the test harness.
function inspectorControl(page: Page, label: string, selector: 'input' | 'select') {
  return page.locator('.control-field')
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator(selector)
}

async function changeSelectOutsideModal(page: Page, label: string, value: string) {
  await inspectorControl(page, label, 'select').selectOption(value, { force: true })
}

async function changeInputOutsideModal(page: Page, label: string, value: string) {
  await inspectorControl(page, label, 'input').evaluate((element, next) => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    setValue?.call(element, next)
    element.dispatchEvent(new Event('input', { bubbles: true }))
  }, value)
}

test('gallery Dialog previews stay passive until opened and restore their trigger', async ({ page }) => {
  await page.goto('/gallery?component=dialog&specimen=dialog-primitive')
  await expect(page.getByRole('heading', { name: 'Initial primitive library' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const dialogCard = page.locator('.gallery-card').filter({ hasText: 'Dialog' })
  const trigger = dialogCard.getByRole('button', { name: 'Open dialog' }).first()
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: 'Dialog title' })
  await expect(dialog).toBeVisible()
  await expect(dialog).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(trigger).toBeFocused()

  await trigger.click()
  await page.locator('.vela-dialog-layer').click({ position: { x: 4, y: 4 } })
  await expect(page.getByRole('dialog', { name: 'Dialog title' })).toHaveCount(0)
})

test('modal focus includes summary and ignores hidden controls', async ({ page }) => {
  await page.goto('/?component=dialog&specimen=dialog-primitive&prop.open=true')
  const dialog = page.getByRole('dialog', { name: 'Dialog title' })
  await expect(dialog).toBeVisible()

  await dialog.evaluate((element) => {
    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.dataset.testid = 'injected-summary'
    summary.textContent = 'Injected focus target'
    details.append(summary)
    element.prepend(details)

    const hidden = document.createElement('button')
    hidden.hidden = true
    hidden.textContent = 'Hidden focus target'
    element.append(hidden)
  })

  await dialog.focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('injected-summary')).toBeFocused()

  await page.getByRole('button', { name: 'Confirm' }).focus()
  await page.keyboard.press('Tab')
  await expect(page.getByTestId('injected-summary')).toBeFocused()
})

test('Dialog follows the simulated phone and comparison canvases', async ({ page }) => {
  await page.goto('/?component=dialog&specimen=dialog-primitive&prop.open=true')
  await page.getByRole('button', { name: 'Phone' }).click({ force: true })

  const previewGrid = page.locator('.preview-grid')
  const phoneLayer = page.locator('.vela-dialog-layer')
  await expect(previewGrid).toHaveCSS('width', '390px')
  const phoneGridBox = await previewGrid.boundingBox()
  const phoneLayerBox = await phoneLayer.boundingBox()
  expect(phoneGridBox).not.toBeNull()
  expect(phoneLayerBox).not.toBeNull()
  expect(phoneLayerBox!.width).toBeLessThanOrEqual(phoneGridBox!.width)

  await page.getByLabel('Compare baseline', { exact: true }).check({ force: true })
  const dialogs = page.getByRole('dialog', { name: 'Dialog title' })
  await expect(dialogs).toHaveCount(2)
  const firstBox = await dialogs.nth(0).boundingBox()
  const secondBox = await dialogs.nth(1).boundingBox()
  expect(firstBox).not.toBeNull()
  expect(secondBox).not.toBeNull()
  expect(firstBox!.x + firstBox!.width).toBeLessThanOrEqual(secondBox!.x)
})

test('scan completion preserves newer props and cannot revive an abandoned scan', async ({ page }) => {
  await page.goto('/?component=dialog&specimen=dialog-rig-discovery&prop.view=start&prop.scenario=mixed&prop.selected=false&prop.rigName=ASCOM%20Remote')
  await page.getByRole('button', { name: 'Scan for rigs' }).click()
  await expect(page.locator('.vela-discovery-scanning[role="status"]')).toBeVisible()

  await changeSelectOutsideModal(page, 'Results', 'single')
  await changeInputOutsideModal(page, 'Rig name', 'Backyard rig')
  await page.waitForTimeout(1000)

  await expect(page.getByRole('heading', { name: 'Rigs on this network' })).toBeVisible()
  await expect(inspectorControl(page, 'Results', 'select')).toHaveValue('single')
  await expect(inspectorControl(page, 'Rig name', 'input')).toHaveValue('Backyard rig')

  await page.getByRole('button', { name: 'Scan again' }).click()
  await page.waitForTimeout(820)
  await changeSelectOutsideModal(page, 'View', 'manual')
  await page.waitForTimeout(200)

  await expect(page.getByRole('heading', { name: 'Enter an Alpaca address' })).toBeVisible()
  await expect(inspectorControl(page, 'View', 'select')).toHaveValue('manual')
})
