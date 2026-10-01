import { expect, test } from '@playwright/test'
import { FIELDROOM_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'
import { observation } from './fixtures/observation'

for (const width of [1440, 390]) {
  test(`appearance preserves the open route and unsaved search at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await page.emulateMedia({ colorScheme: 'light' })
    await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
    await page.route('**/api/web/navigation', route => route.fulfill({ json: { rigs: [{ id: 'rig-1', name: 'Seestar S30' }], captures: [] } }))
    await page.route('**/api/web/rigs/rig-1', route => route.fulfill({ json: observation('complete').rig }))
    await page.goto('/rigs/rig-1/observe/targets?q=M31')
    const search = page.getByRole('searchbox', { name: 'Find a target' })
    await search.fill('Unsaved search')
    await expect(page).toHaveURL(/q=Unsaved\+search/)
    await search.evaluate(element => element.setAttribute('data-appearance-test', 'retained'))
    const initialUrl = page.url()
    const root = page.locator('html')
    await expect(root).toHaveAttribute('data-mode', 'light')
    const tokens = themeStyle(resolveTheme(FIELDROOM_PROFILE), 'light')
    expect(await root.evaluate(element => element.style.getPropertyValue('--vela-canvas'))).toBe(tokens['--vela-canvas'])
    await expect(root).toHaveCSS('color-scheme', 'light')
    await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', tokens['--vela-canvas'])
    await expect(page.locator('.vela-app__connection')).toHaveText('● Connected')
    const trigger = page.getByRole('button', { name: 'Appearance', exact: true })
    await trigger.click()
    await page.getByRole('radio', { name: 'Dark' }).check()
    await expect(root).toHaveAttribute('data-mode', 'dark')
    await expect(search).toHaveValue('Unsaved search')
    expect(page.url()).toBe(initialUrl)
    await expect(search).toHaveAttribute('data-appearance-test', 'retained')
    await expect(page.getByRole('status').filter({ hasText: 'Saved for this browser.' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toHaveCount(0)
    await page.emulateMedia({ colorScheme: 'dark' })
    await page.emulateMedia({ colorScheme: 'light' })
    await expect(root).toHaveAttribute('data-mode', 'dark')
    await trigger.click()
    await page.getByRole('radio', { name: 'System' }).check()
    await expect(root).toHaveAttribute('data-mode', 'light')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(root).toHaveAttribute('data-mode', 'dark')
    await search.click()
    await expect(page.getByRole('dialog', { name: 'Appearance' })).toHaveCount(0)
    await expect(search).toHaveValue('Unsaved search')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

test('blocked storage permits appearance changes with honest visit-only feedback', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked storage') } }))
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.goto('/')
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('radio', { name: 'Dark' }).check()
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  await expect(page.getByRole('status').filter({ hasText: 'For this visit only.' })).toBeVisible()
})


test('saved appearance is on the root before the first route DOM is inserted', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' })
  await page.addInitScript(() => {
    localStorage.setItem('vela.appearance', 'dark')

    const observer = new MutationObserver(() => {
      if (!document.querySelector('#root > *')) return
      const root = document.documentElement
      root.dataset.firstRouteMode = root.dataset.mode
      root.dataset.firstRouteCanvas = root.style.getPropertyValue('--vela-canvas')
      observer.disconnect()
    })

    observer.observe(document, { childList: true, subtree: true })
  })
  await page.route('**/api/**', route => route.fulfill({ status: 503, json: { error: 'Unavailable' } }))
  await page.goto('/')
  const tokens = themeStyle(resolveTheme(FIELDROOM_PROFILE), 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-first-route-mode', 'dark')
  await expect(page.locator('html')).toHaveAttribute('data-first-route-canvas', tokens['--vela-canvas'])
})
