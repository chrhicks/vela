import { expect, test } from '@playwright/test'

const url = (width: number, props = '') => `/?component=panel&specimen=panel-target-framing&profile=vela-current&mode=dark&context=isolated&viewport=${width}${props}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1400 })
  await page.route('**/__workshop/**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ session: null, profiles: [] }) }))
})

for (const width of [1040, 390]) {
  test(`search and compose with recoverable frame position at ${width}px`, async ({ page }) => {
    await page.goto(url(width))
    const demo = page.locator('.vela-target-demo')
    await demo.getByRole('searchbox').fill('NGC6888')
    await expect(demo.locator('.vela-target-card')).toHaveCount(1)
    await demo.getByRole('button', { name: /Crescent Nebula/ }).click()
    const slider = demo.getByRole('slider', { name: 'Horizontal frame position' })
    await slider.focus()
    await slider.press('ArrowRight')
    await expect(slider).toHaveValue('51')
    await expect(page).toHaveURL(/prop.frameX=51/)
    await page.reload()
    await expect(slider).toHaveValue('51')
    await expect(demo.locator('.vela-target-frame')).toHaveCSS('left', /.+px/)
    expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await demo.getByRole('button', { name: 'Preview slew & check' }).click()
    await expect(demo.getByRole('status')).toHaveText('Slewing · preview simulation')
    await expect(slider).toBeDisabled()
    await expect(demo.getByRole('status')).toHaveText('Framing check · example offset')
    await expect(demo.locator('.vela-target-frame--actual')).toBeVisible()
    await demo.getByRole('button', { name: 'Adjust composition' }).click()
    await expect(slider).toBeEnabled()
    await expect(slider).toHaveValue('51')
    await demo.getByRole('button', { name: 'Reset frame' }).click()
    await expect(slider).toHaveValue('50')
    await demo.getByRole('button', { name: '← Targets' }).click()
    await demo.getByRole('searchbox').fill('nothing matches')
    await expect(demo.getByRole('heading', { name: 'No matching sample targets' })).toBeVisible()
    await demo.getByRole('button', { name: 'Clear search' }).click()
    await expect(demo.locator('.vela-target-card')).toHaveCount(3)
  })
}

test('stopping cancels completion and an unconfirmed slew remains distinct', async ({ page }) => {
  await page.clock.install()
  await page.goto(url(1040, '&prop.screen=compose&prop.failSlew=true'))
  const demo = page.locator('.vela-target-demo')
  await demo.getByRole('button', { name: 'Preview slew & check' }).click()
  await expect(demo.getByRole('status')).toHaveText('Slewing · preview simulation')
  await demo.getByRole('button', { name: 'Stop preview' }).click()
  await page.clock.runFor(2000)
  await expect(demo.getByRole('status')).toHaveText('Preview stopped')
  await demo.getByRole('button', { name: 'Preview slew & check' }).click()
  await page.clock.runFor(2000)
  await expect(demo.getByRole('status')).toHaveText('Slew not confirmed')
  await expect(demo.locator('.vela-target-frame--actual')).toHaveCount(0)
})

test('unavailable reference still permits target selection in light mode', async ({ page }) => {
  await page.goto(url(390, '&prop.imageUnavailable=true').replace('mode=dark', 'mode=light'))
  const demo = page.locator('.vela-target-demo')
  await expect(demo.getByText('Reference image unavailable', { exact: true })).toHaveCount(3)
  await demo.getByRole('button', { name: /Andromeda Galaxy/ }).click()
  await expect(demo.getByRole('heading', { name: 'Andromeda Galaxy', exact: true })).toBeVisible()
  await expect(demo.getByText('Obstructions unknown', { exact: true })).toBeVisible()
})
