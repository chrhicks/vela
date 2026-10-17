import { expect, test, type Page } from '@playwright/test'
import { openAlignmentScene, openEquipmentScene, openExploreScene } from './fixtures/fieldroom/browser'

const phone = { width: 390, height: 844 }

async function tabBarTop(page: Page) {
  const box = await page.locator('.vela-navigation__tabs').boundingBox()

  return box!.y
}

test('the phone tab bar presents the page links and follows the current page', async ({ page }) => {
  await page.setViewportSize(phone)
  await openExploreScene(page, 'preparation-light')
  const tabs = page.getByRole('navigation', { name: 'Observing pages' })
  await expect(tabs).toHaveCount(1)
  await expect(tabs).toHaveClass('vela-navigation__tabs')
  await expect(tabs.getByRole('link')).toHaveText(['Tonight', 'Targets', 'Photographs'])
  await expect(tabs.getByRole('link', { name: 'Tonight' })).toHaveAttribute('aria-current', 'page')
  expect(await page.locator('.vela-navigation__tabs').boundingBox()).toEqual({ x: 0, y: 776, width: 390, height: 68 })
  await expect(page.locator('main')).toHaveCSS('padding-bottom', '68px')
  expect((await page.locator('.vela-navigation__bar').boundingBox())!.height).toBe(60)

  await tabs.getByRole('link', { name: 'Targets' }).click()
  await expect(page).toHaveURL(/\/rigs\/fra400\/observe\/targets$/)
  await expect(tabs.getByRole('link', { name: 'Targets' })).toHaveAttribute('aria-current', 'page')
  await expect(tabs.getByRole('link', { name: 'Tonight' })).not.toHaveAttribute('aria-current')

  await tabs.getByRole('link', { name: 'Photographs' }).click()
  await expect(page).toHaveURL(/\/rigs\/fra400\/observe\/saved-images$/)
  await expect(tabs.getByRole('link', { name: 'Photographs' })).toHaveAttribute('aria-current', 'page')

  await tabs.getByRole('link', { name: 'Tonight' }).click()
  await expect(page).toHaveURL(/\/rigs\/fra400\/observe\/capture$/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('desktop keeps the page links in the header without a tab bar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openExploreScene(page, 'preparation-light')
  const pages = page.getByRole('navigation', { name: 'Observing pages' })
  await expect(pages).toHaveClass('vela-navigation__pages')
  await expect(pages.getByRole('link', { name: 'Tonight' })).toHaveAttribute('aria-current', 'page')
  await expect(page.locator('.vela-navigation__tabs')).toBeHidden()
  await expect(page.locator('main')).toHaveCSS('padding-bottom', '0px')
})

test('preparation keeps its own return bar and full height on a phone', async ({ page }) => {
  await page.setViewportSize(phone)
  await openAlignmentScene(page, 'alignment-phone-adjusting')
  await expect(page.getByRole('link', { name: '← Tonight' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Observing pages' })).toHaveCount(0)
  await expect(page.locator('main')).toHaveCSS('padding-bottom', '0px')
})

test('without a rig the tab bar offers only Explore the sky', async ({ page }) => {
  await page.setViewportSize(phone)
  await openEquipmentScene(page, 'home-rigs')
  const tabs = page.getByRole('navigation', { name: 'Observing pages' })
  await expect(tabs.getByRole('link')).toHaveText(['Explore the sky'])
  await expect(tabs.getByRole('link')).toHaveAttribute('href', '/explore')
})

test('the rig menu opens from the one-row phone header', async ({ page }) => {
  await page.setViewportSize(phone)
  await openEquipmentScene(page, 'equipment-connected')
  await page.getByRole('button', { name: /^Viewing rig/ }).click()
  const rigPage = page.getByRole('link', { name: 'Rig & equipment', exact: true })
  await expect(rigPage).toBeVisible()
  await expect(page.getByRole('button', { name: 'All rigs', exact: true })).toBeVisible()
  const menu = (await page.locator('.vela-navigation__rig-menu').boundingBox())!
  expect(menu.x).toBeGreaterThanOrEqual(0)
  expect(menu.x + menu.width).toBeLessThanOrEqual(phone.width)
  expect(menu.y + menu.height).toBeLessThan(await tabBarTop(page))
})
