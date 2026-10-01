import { expect, test } from '@playwright/test'
import { FIELDROOM_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'
import { observation } from './fixtures/observation'
import type { CaptureView } from '@vela/model/web'

const theme = resolveTheme(FIELDROOM_PROFILE)

const tokens = themeStyle(theme, 'dark')

for (const width of [1040, 390]) {
  test(`preserves shared theme tokens and geometry in the app at ${width}px`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.setViewportSize({ width, height: 900 })
    await page.route('**/api/web/navigation', route =>
      route.fulfill({ json: { rigs: [{ id: 'rig-1', name: observation().rig.name }], captures: [] } }),
    )
    await page.route('**/api/web/rigs/rig-1', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(observation().rig),
      }),
    )
    await page.goto('/rigs/rig-1')
    const panel = page.locator('.vela-rig-device').first()
    await expect(panel).toBeVisible()

    // A shared component can still drift when its app shell selects a different
    // profile or app CSS replaces inherited theme values with root-sized text.
    const actualTokens = await page.locator('.vela-theme').evaluate((element, names) => {
      const style = getComputedStyle(element)

      return Object.fromEntries(names.map(name => [name, style.getPropertyValue(name).trim()]))
    }, Object.keys(tokens))

    expect(actualTokens).toEqual(tokens)
    await expect(page.locator('.vela-button').first()).toHaveCSS(
      'border-radius',
      `${theme.radius}px`,
    )
    await expect(panel).toHaveCSS('border-radius', '6px')
    await expect(panel).toHaveCSS('border-top-width', `${theme.borderWidth}px`)
    await expect(panel).toHaveCSS('border-top-style', 'solid')
    await expect(panel.locator('.vela-panel__title')).toHaveCSS(
      'font-size',
      `${theme.fontSize * 0.96}px`,
    )
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)

    const capture: CaptureView = {
      captureReadState: 'current',
      rigId: 'rig-1',
      rigName: 'Seestar S30',
      camera: { name: 'Main camera' },
      enabled: true,
      unavailableReason: null,
      phase: 'idle',
      active: false,
      exposureSeconds: 2,
      elapsedSeconds: 0,
      error: null,
      saveFrames: false,
      savedImageCount: 0,
      latestImage: null,
      repeat: false,
      completedCount: 0,
      cooling: null,
      subject: null, savedCount: 0, integrationSeconds: 0,
    }

    await page.route('**/api/web/rigs/rig-1/capture', route =>
      route.fulfill({
        contentType: 'application/json',
        body: JSON.stringify(capture),
      }),
    )
    await page.goto('/rigs/rig-1/observe/capture')
    // Loading shared CSS after route CSS would silently win this equal-
    // specificity rule and shrink the specimen's command to the base size.
    await expect(page.getByRole('button', { name: 'Take exposure' })).toHaveCSS(
      'min-height',
      '46px',
    )
    await expect(page.locator('.tonight-capture')).toHaveCSS('border-radius', '6px')
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true)
  })
}
