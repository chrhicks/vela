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
  await frame.focus()
  await frame.press('ArrowRight')
  await page.getByRole('button', { name: 'Start from: Frame checked', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Frame checked/ }).click()
  await expect(exposure).toHaveValue('2')
  await expect(frame).toHaveAttribute('aria-valuenow', '50')
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()

  await exposure.fill('12')
  await page.getByRole('button', { name: 'Start from: Frame checked', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Ready to frame/ }).click()
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
  await expect(exposure).toHaveValue('2')
  await page.getByRole('button', { name: 'Check current frame', exact: true }).click()
  await expect(page.getByText('Framing checked · demo', { exact: true })).toBeVisible()
  await expect(page).toHaveURL(/scenario=ready/)

  await page.getByRole('button', { name: 'Start from: Ready to frame', exact: true }).click()
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
  await page.getByRole('button', { name: 'Width: Fit', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Phone · 390 px', exact: true }).click()
  await expect(page).toHaveURL(/viewport=390/)
  await page.getByRole('button', { name: 'Appearance: Light', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Dark', exact: true }).click()

  await expect(page.locator('.feature-preview-surface')).toHaveAttribute('data-mode', 'dark')
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await expect(exposure).toHaveValue('8')
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Width: Phone · 390 px', exact: true }).click()
  await page.getByRole('menuitemradio', { name: /^Fit/ }).click()
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
  await expect(page.getByRole('button', { name: /^Start from:/ })).toHaveCount(0)
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

  for (const name of ['Width: Fit', 'Appearance: Light', 'Start from: Frame checked', 'Reset', 'Copy link', 'Focus preview']) {
    const button = page.getByRole('button', { name, exact: true })
    await expect(button).toBeVisible()
    const bounds = await button.boundingBox()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  }

  await page.screenshot({ path: '/tmp/vela-workshop-mobile-preview.png', fullPage: true })
  await page.getByRole('button', { name: 'Start from: Frame checked', exact: true }).click()
  const menu = page.getByRole('menu', { name: 'Choose a starting scenario' })
  await expect(menu).toBeVisible()
  const bounds = await menu.boundingBox()
  expect(bounds!.x).toBeGreaterThanOrEqual(0)
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '/tmp/vela-workshop-mobile-scenarios.png', fullPage: true })
})

test('keyboard scenario navigation dismisses with Escape and restores trigger focus', async ({ page }) => {
  await page.goto(checkedPreview)
  const trigger = page.getByRole('button', { name: 'Start from: Frame checked', exact: true })
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
  await expect(page.getByRole('button', { name: 'Start from: Frame checked', exact: true })).toHaveCount(0)
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await expect(page.getByRole('button', { name: 'Return to workshop', exact: true })).toHaveCount(0)
  await expect(frame).toHaveAttribute('aria-valuenow', '51')
  await expect(page.getByText('Ready to frame', { exact: true })).toBeVisible()
})

test('focus mode reserves space below the preview for its return control', async ({ page }) => {
  for (const browserWidth of [390, 1440]) {
    await page.setViewportSize({ width: browserWidth, height: 667 })

    for (const viewport of ['fit', '390']) {
      await page.goto(checkedPreview.replace('viewport=fit', `viewport=${viewport}`))
      await page.getByRole('button', { name: 'Focus preview', exact: true }).click()
      const surface = await page.locator('.feature-preview-surface').boundingBox()
      const control = await page.getByRole('button', { name: 'Return to workshop', exact: true }).boundingBox()
      expect(surface!.height).toBeGreaterThan(0)
      expect(control!.y).toBeGreaterThanOrEqual(surface!.y + surface!.height)
      expect(control!.y + control!.height).toBeLessThanOrEqual(667)
    }
  }
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


test('fixed Phone width fits an equally wide browser while larger widths stay explicit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(checkedPreview.replace('viewport=fit', 'viewport=390'))
  const stage = page.locator('.feature-preview-stage')
  const surface = page.locator('.feature-preview-surface')
  await expect(page.getByRole('button', { name: 'Width: Phone · 390 px' })).toBeVisible()
  expect(await surface.evaluate(element => element.getBoundingClientRect().width)).toBe(390)
  expect(await stage.evaluate(element => element.scrollWidth - element.clientWidth)).toBe(0)

  await page.getByRole('button', { name: 'Width: Phone · 390 px' }).click()
  await page.getByRole('menuitemradio', { name: 'Desktop · 1280 px' }).click()
  expect(await surface.evaluate(element => element.getBoundingClientRect().width)).toBe(1280)
  expect(await stage.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true)
})

test('long feature, design, and scenario labels keep toolbar controls within the browser', async ({ page }) => {
  const featureLabel = 'Guide-camera signal check before starting an observing session'

  const designLabels = [
    'Guide-star image beside the latest signal reading',
    'Signal reading above a compact guide-star image',
  ]

  const scenarioLabels = [
    'A clear guide star after removing the lens cap',
    'A faint guide star with thin cloud crossing the field',
  ]

  const feature = {
    id: 'long-labels', label: featureLabel, description: 'Toolbar layout fixture', collection: 'current',
    thumbnail: { src: '/unused-thumbnail.png', alt: 'Unused preview thumbnail' },
    defaultDesign: 'design-0',
    designs: designLabels.map((label, index) => ({
      id: `design-${index}`, label, intent: 'Keep the complete choice readable.', defaultScenario: 'scenario-0',
      scenarios: scenarioLabels.map((label, index) => ({ id: `scenario-${index}`, label })),
    })),
  }

  await page.route('**/src/feature-workspace/catalog.ts*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const catalogErrors = []
      export const featureCatalog = ${JSON.stringify([feature])}
      for (const design of featureCatalog[0].designs)
        for (const scenario of design.scenarios) scenario.render = () => 'Local preview fixture'`,
  }))

  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/features/long-labels?design=design-0&scenario=scenario-0&mode=light&viewport=fit')
    await expect(page.getByText('Local preview fixture')).toBeVisible()
    const toolbar = page.locator('.feature-toolbar')
    const controls = toolbar.locator('h1, button')

    for (const control of await controls.all()) {
      const bounds = await control.boundingBox()
      expect(bounds).not.toBeNull()
      expect(bounds!.x).toBeGreaterThanOrEqual(0)
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
      expect(await control.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    }

    expect(await page.locator('.feature-preview-surface').evaluate(element => element.clientWidth)).toBe(width)
    await page.getByRole('button', { name: `Design: ${designLabels[0]}`, exact: true }).click()
    const menu = page.getByRole('menu', { name: 'Choose a design' })
    const menuBounds = await menu.boundingBox()
    expect(menuBounds!.x).toBeGreaterThanOrEqual(0)
    expect(menuBounds!.x + menuBounds!.width).toBeLessThanOrEqual(width)
    await page.getByRole('menuitemradio', { name: designLabels[1], exact: true }).click()
    await expect(page.getByRole('button', { name: `Design: ${designLabels[1]}`, exact: true })).toBeVisible()
    await page.getByRole('button', { name: `Start from: ${scenarioLabels[0]}`, exact: true }).click()
    await page.getByRole('menuitemradio', { name: scenarioLabels[1], exact: true }).click()
    await expect(page.getByRole('button', { name: `Start from: ${scenarioLabels[1]}`, exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Width: Fit', exact: true }).click()
    await page.getByRole('menuitemradio', { name: 'Desktop · 1280 px', exact: true }).click()
    expect(await page.locator('.feature-preview-surface').evaluate(element => element.clientWidth)).toBe(1280)
    expect(await page.locator('.feature-workspace').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
})

test('returning from a feature preserves the shelf collection and search', async ({ page }) => {
  const features = [
    { id: 'cloud-trend', label: 'Cloud trend', collection: 'current' },
    { id: 'sky-brightness', label: 'Sky brightness', collection: 'past' },
  ].map(feature => ({
    ...feature,
    description: 'Sky conditions study',
    thumbnail: { src: '/unused-thumbnail.png', alt: 'Study preview' },
    defaultDesign: 'trend',
    designs: [{
      id: 'trend', label: 'Quiet trend', intent: 'Inspect a trend.', defaultScenario: 'initial',
      scenarios: [{ id: 'initial', label: 'Initial reading' }],
    }],
  }))

  await page.route('**/src/feature-workspace/catalog.ts*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `export const catalogErrors = []
      export const featureCatalog = ${JSON.stringify(features)}
      for (const feature of featureCatalog)
        feature.designs[0].scenarios[0].render = () => feature.label`,
  }))
  await page.goto('/features')
  await page.getByRole('tab', { name: 'Past explorations', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Find a feature' }).fill('brightness')
  await page.getByRole('link', { name: 'Open Sky brightness', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Sky brightness', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Features', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Past explorations', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('searchbox', { name: 'Find a feature' })).toHaveValue('brightness')
  await expect(page.getByRole('link', { name: 'Open Sky brightness', exact: true })).toBeVisible()

  await page.getByRole('tab', { name: 'Current', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Find a feature' }).fill('cloud')
  await page.getByRole('link', { name: 'Open Cloud trend', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Cloud trend', exact: true })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('tab', { name: 'Current', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('searchbox', { name: 'Find a feature' })).toHaveValue('cloud')
  await expect(page.getByRole('link', { name: 'Open Cloud trend', exact: true })).toBeVisible()
})
