import { expect, test } from '@playwright/test'

for (const width of [1040, 390]) {
  test(`navigation keeps rig context and returns to the right capture at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1400 })
    await page.route('**/__workshop/**', route =>
      route.fulfill({ json: { session: null, profiles: [] } }),
    )
    await page.goto(
      `/?component=panel&specimen=panel-navigation&profile=vela-current&mode=dark&context=isolated&viewport=${width}`,
    )
    const demo = page.getByRole('region', { name: 'Navigation experiment' })
    const bar = demo.locator('header')
    await expect(bar.getByRole('link', { name: 'Targets', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(bar.locator('progress')).toHaveAttribute('value', '18')
    await demo.getByRole('slider', { name: 'Sample exposure elapsed seconds' }).fill('60')
    await expect(bar.locator('progress')).toHaveAttribute('value', '60')
    await expect(bar.getByRole('link', { name: /17 captured/ })).toBeVisible()
    await demo.getByLabel('Try the bar with').selectOption('reading')
    await expect(bar.locator('progress')).toHaveCount(0)
    await expect(bar.getByRole('link', { name: /17 captured.*Reading image/ })).toBeVisible()
    await demo.getByLabel('Try the bar with').selectOption('capturing')
    await demo.getByRole('slider', { name: 'Sample exposure elapsed seconds' }).fill('18')
    await bar.getByLabel('Viewing rig').selectOption('seestar')
    await expect(demo.getByRole('heading', { name: 'Observe', exact: true })).toBeVisible()
    await expect(bar.getByRole('link', { name: /Capture running on Askar/ })).toContainText('Askar')
    await bar.getByRole('link', { name: /Capture running on Askar/ }).click()
    await expect(bar.getByLabel('Viewing rig')).toHaveValue('askar')
    await expect(demo.getByRole('heading', { name: 'Capture', exact: true })).toBeVisible()
    await demo.getByLabel('Try the bar with').selectOption('interrupted')
    await expect(bar.getByRole('link', { name: /Capture updates lost/ })).toBeVisible()
    await expect(bar.locator('progress')).toHaveCount(0)
    await expect(bar.getByText('Last known · open Capture →')).toBeVisible()
    await expect(demo.getByText(/The current outcome is unknown/)).toBeVisible()
    await demo.getByLabel('Try the bar with').selectOption('idle')
    await expect(bar.locator('.vela-navigation__activity')).toHaveCount(0)
    await expect(demo.getByText('No active capture', { exact: true })).toBeVisible()
    await bar.getByRole('link', { name: 'Vela · all rigs' }).click()
    await expect(demo.getByRole('heading', { name: 'Choose a rig' })).toBeVisible()
    await expect(bar.getByRole('navigation')).toHaveCount(0)
    await bar.getByLabel('Viewing rig').selectOption('askar')
    await bar.getByRole('link', { name: 'Targets', exact: true }).click()
    await demo.getByLabel('Try the bar with').selectOption('capturing')
    expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await demo.screenshot({ path: `/tmp/vela-navigation-${width}.png` })
    await bar.getByLabel('Viewing rig').selectOption('seestar')
    await bar.getByRole('link', { name: 'Capture', exact: true }).click()
    await demo.getByLabel('Try the bar with').selectOption('interrupted')
    await page.reload()
    await expect(bar.getByLabel('Viewing rig')).toHaveValue('seestar')
    await expect(bar.getByRole('link', { name: 'Capture', exact: true })).toHaveAttribute(
      'aria-current',
      'page',
    )
    await expect(bar.getByRole('link', { name: /Capture updates lost on Askar/ })).toBeVisible()
    await expect(demo.getByLabel('Try the bar with')).toHaveValue('interrupted')
  })
}
