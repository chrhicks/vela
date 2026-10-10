import { expect, test } from '@playwright/test'
import { FIELDROOM_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'

// A reload or cold launch paints index.html before any module runs. Its canvas must
// already match the theme the app will apply, so the page never flashes white.
const cases = [
  { system: 'light', saved: null, mode: 'light' },
  { system: 'dark', saved: null, mode: 'dark' },
  { system: 'light', saved: 'dark', mode: 'dark' },
  { system: 'dark', saved: 'light', mode: 'light' },
  { system: 'dark', saved: 'system', mode: 'dark' },
] as const

for (const { system, saved, mode } of cases) {
  test(`paints the ${mode} canvas before the app loads (system ${system}, saved ${saved ?? 'none'})`, async ({
    page,
  }) => {
    const canvas = themeStyle(resolveTheme(FIELDROOM_PROFILE), mode)['--vela-canvas']

    await page.emulateMedia({ colorScheme: system })

    if (saved) {
      await page.addInitScript(
        (value) => localStorage.setItem('vela.appearance', value),
        saved,
      )
    }

    // No application module runs: only index.html can paint.
    await page.route('**/src/main.tsx', (route) => route.abort())
    await page.goto('/rigs/rig-1/observe/capture')

    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-mode', mode)
    await expect(root).toHaveCSS('background-color', hexToRgb(canvas))
    await expect(root).toHaveCSS('color-scheme', mode)
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', canvas)
    await expect(page.locator('#root')).toBeEmpty()
  })
}

test('the app keeps the same canvas once its theme applies', async ({ page }) => {
  const canvas = themeStyle(resolveTheme(FIELDROOM_PROFILE), 'dark')['--vela-canvas']

  await page.emulateMedia({ colorScheme: 'dark' })
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 503, json: { error: 'Unavailable' } }),
  )
  await page.goto('/')

  const root = page.locator('html')
  await expect
    .poll(() => root.evaluate((element) => element.style.getPropertyValue('--vela-canvas')))
    .toBe(canvas)
  await expect(root).toHaveCSS('background-color', hexToRgb(canvas))
  await expect(page.locator('body')).toHaveCSS('background-color', hexToRgb(canvas))
})

function hexToRgb(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)

  return `rgb(${value >> 16}, ${(value >> 8) & 255}, ${value & 255})`
}
