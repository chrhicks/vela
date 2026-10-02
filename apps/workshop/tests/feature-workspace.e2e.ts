import { expect, test } from '@playwright/test'

const checkedPreview = '/features/framing?design=sky-context&scenario=frame-checked&mode=light&viewport=fit'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.route('**/__workshop/**', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ session: null, profiles: [] }),
  }))
})

test('Reset and scenario changes restore the starting scene after local interaction', async ({ page }) => {
  await page.goto(checkedPreview)
  const frame = page.getByRole('slider', { name: 'Camera frame position' })
  const exposure = page.getByRole('spinbutton', { name: 'Test exposure (seconds)' })

  await frame.focus()
  await frame.press('ArrowRight')
  await exposure.fill('8')
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(frame).toHaveAttribute('aria-valuenow', '50')
  await expect(exposure).toHaveValue('2')
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()

  await exposure.fill('12')
  await page.getByRole('button', { name: 'Scenario: Frame checked', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Ready to frame/ }).click()
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
  await expect(exposure).toHaveValue('2')
  await page.getByRole('button', { name: 'Check current frame', exact: true }).click()
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/scenario=ready/)

  await page.getByRole('button', { name: 'Scenario: Ready to frame', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Through the night/ }).click()
  const dialog = page.getByRole('dialog', { name: 'North America Nebula · Through the night' })
  await expect(dialog).toBeVisible()
  await page.getByRole('button', { name: 'Close sky view', exact: true }).click()
  await expect(dialog).toHaveCount(0)
  await page.getByRole('button', { name: 'Reset', exact: true }).click()
  await expect(dialog).toBeVisible()
})

test('appearance and viewport changes preserve local interaction state', async ({ page }) => {
  await page.goto(checkedPreview)
  const frame = page.getByRole('slider', { name: 'Camera frame position' })
  const exposure = page.getByRole('spinbutton', { name: 'Test exposure (seconds)' })
  await frame.focus()
  await frame.press('ArrowRight')
  await exposure.fill('8')
  await page.getByRole('button', { name: 'Phone', exact: true }).click()
  await expect(page).toHaveURL(/viewport=390/)
  await page.getByRole('button', { name: 'Appearance: Light', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click()

  await expect(page.locator('.feature-preview-surface')).toHaveAttribute('data-mode', 'dark')
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await expect(exposure).toHaveValue('8')
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Desktop', exact: true }).click()
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await expect(exposure).toHaveValue('8')
})

test('Copy link preserves the measured viewport and starting scenario, not interaction progress', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { sessionStorage.setItem('test-copied-link', value) } },
    })
  })
  await page.goto(checkedPreview)
  const frame = page.getByRole('slider', { name: 'Camera frame position' })
  await frame.focus()
  await frame.press('ArrowRight')
  const measuredWidth = await page.locator('.feature-preview-surface').evaluate(element => Math.round(element.getBoundingClientRect().width))
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible()
  const copied = await page.evaluate(() => sessionStorage.getItem('test-copied-link'))
  expect(copied).not.toBeNull()
  const link = new URL(copied!)
  expect(link.searchParams.get('viewport')).toBe(String(measuredWidth))
  expect(link.searchParams.get('scenario')).toBe('frame-checked')

  await page.evaluate(() => localStorage.setItem('vela.workshop.feature.framing', JSON.stringify({
    designId: 'sky-context', scenarioId: 'ready', mode: 'dark', viewport: 390,
  })))
  await page.goto(link.href)
  await expect(frame).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
  await expect(page.locator('.feature-preview-surface')).toHaveAttribute('data-mode', 'light')
  await page.reload()
  await expect(frame).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
})

test('invalid preview links explain the missing selection and offer an explicit recovery', async ({ page }) => {
  await page.goto('/features/framing?scenario=removed-scene')
  await expect(page.getByRole('heading', { name: 'Preview unavailable' })).toBeVisible()
  await expect(page.getByText('The scenario “removed-scene” is not available in Sky beside the heading.')).toBeVisible()
  await expect(page.getByRole('slider', { name: 'Camera frame position' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Open default preview' }).click()
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
  await page.goto('/features/removed-feature')
  await expect(page.getByRole('heading', { name: 'Preview unavailable' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Open default preview' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Back to Features' }).click()
  await expect(page).toHaveURL(/\/$/)
})

test('legacy specimen and gallery links still open the design system', async ({ page }) => {
  await page.goto('/?component=panel&specimen=panel-frame-context&profile=fieldroom&prop.state=Checked')
  await expect(page.getByRole('heading', { name: 'Frame context · Draft product example', exact: true })).toBeVisible()
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Scenario:/ })).toHaveCount(0)
  await page.goto('/gallery')
  await expect(page.getByRole('heading', { name: 'Initial primitive library', exact: true })).toBeVisible()
  await expect(page.locator('.feature-preview')).toHaveCount(0)
})

test('phone preview contains its sky dialog within the selected surface', async ({ page }) => {
  await page.goto('/features/framing?design=sky-context&scenario=through-the-night&mode=light&viewport=390')
  const dialog = page.getByRole('dialog', { name: 'North America Nebula · Through the night' })
  await expect(dialog).toBeVisible()
  const surface = await page.locator('.feature-preview-surface').boundingBox()
  const bounds = await dialog.boundingBox()
  expect(surface).not.toBeNull()
  expect(bounds).not.toBeNull()
  expect(surface!.width).toBe(390)
  expect(bounds!.x).toBeGreaterThanOrEqual(surface!.x)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(surface!.x + surface!.width)
  expect(bounds!.y).toBeGreaterThanOrEqual(surface!.y)
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(surface!.y + surface!.height)
})

test('shelf and fit preview work on an actual 390px mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Features', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open Framing' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: '/tmp/vela-workshop-mobile-shelf.png', fullPage: true })

  await page.goto(checkedPreview)
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)

  for (const name of ['Desktop', 'Phone', 'Appearance: Light', 'Scenario: Frame checked', 'Reset', 'Copy link', 'Focus preview']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const bounds = await button.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  }

  await page.screenshot({ path: '/tmp/vela-workshop-mobile-preview.png', fullPage: true })
  await page.getByRole('button', { name: 'Scenario: Frame checked', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Choose a starting scenario' })
  await expect(menu).toBeVisible()
  const bounds = await menu.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '/tmp/vela-workshop-mobile-scenarios.png', fullPage: true })
})

test('keyboard scenario navigation dismisses with Escape and restores trigger focus', async ({ page }) => {
  await page.goto(checkedPreview)
  const trigger = page.getByRole('button', { name: 'Scenario: Frame checked', exact: true })
  await trigger.focus()
  await page.keyboard.press('ArrowDown')
  const selected = page.getByRole('menuitemradio', { name: /^Frame checked/ })
  await expect(selected).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitemradio', { name: /^Through the night/ })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(trigger).toBeFocused()
  await expect(page).toHaveURL(/scenario=frame-checked/)
})

test('clipboard rejection leaves a usable copyable starting link', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('Clipboard access denied') } },
    })
  })
  await page.goto(checkedPreview)
  await page.getByRole('button', { name: 'Copy link', exact: true }).click()
  const fallback = page.getByRole('textbox', { name: 'Copy this link to reopen the same starting scenario:' })
  await expect(fallback).toBeVisible()
  expect(new URL(await fallback.inputValue()).searchParams.get('scenario')).toBe('frame-checked')
  await fallback.focus()
  expect(await fallback.evaluate(input => input instanceof HTMLInputElement
    && input.selectionStart === 0 && input.selectionEnd === input.value.length)).toBe(true)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect(fallback).toHaveCount(0)
})

test('focus mode keeps interaction state and Escape returns focus to its control', async ({ page }) => {
  await page.goto(checkedPreview)
  const frame = page.getByRole('slider', { name: 'Camera frame position' })
  const trigger = page.getByRole('button', { name: 'Focus preview', exact: true })
  await frame.focus()
  await frame.press('ArrowRight')
  await trigger.click()
  await expect(page.getByRole('button', { name: 'Return to workshop', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'Scenario: Frame checked', exact: true })).toHaveCount(0)
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('button', { name: 'Return to workshop', exact: true })).toHaveCount(0)
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
})


test('a short phone can scroll the shelf to open its feature', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 667 })
  await page.goto('/')
  const openFeature = page.getByRole('link', { name: 'Open Framing', exact: true })
  await expect(openFeature).not.toBeInViewport()
  await page.mouse.move(190, 500)
  await page.mouse.wheel(0, 500)
  await expect(openFeature).toBeInViewport()
  await openFeature.click()
  await expect(page.getByRole('slider', { name: 'Camera frame position' })).toHaveCount(1)
  await expect(page).toHaveURL(/\/features\/framing\?/)
})
