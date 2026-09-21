import { expect, test } from '@playwright/test'

const primitiveUrl = (props = '') =>
  `/?component=sky-path&specimen=sky-path-primitive&profile=vela-current&mode=dark&context=isolated&viewport=390${props}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1400 })
  await page.route('**/__workshop/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: null, profiles: [] }),
    }),
  )
})

test('time selection updates the readout and URL without inventing a local horizon', async ({
  page,
}) => {
  await page.goto(primitiveUrl())
  const sky = page.locator('.vela-sky-path-specimen')
  const time = sky.getByRole('slider', { name: 'Preview time for Andromeda' })
  await expect(sky.getByText('Local obstructions not included', { exact: true })).toBeVisible()
  await expect(sky.getByRole('slider', { name: /Elevation margin/ })).toHaveCount(0)
  await time.focus()
  await time.press('ArrowRight')
  await expect(time).toHaveValue('19')
  await expect(sky.locator('.vela-sky-path__readout')).toContainText('23:10')
  await expect(page).toHaveURL(/prop.selectedIndex=19/)
  await page.reload()
  await expect(time).toHaveValue('19')
  expect(await sky.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})

test('incomplete and uncalibrated profiles retain their uncertainty', async ({ page }) => {
  await page.goto(primitiveUrl('&prop.horizon=incomplete&prop.selectedIndex=29'))
  const sky = page.locator('.vela-sky-path-specimen')
  await expect(
    sky.getByText('Local horizon unknown in this direction', { exact: true }),
  ).toBeVisible()
  await expect(sky.getByText('Unknown', { exact: true })).toBeVisible()
  expect(await sky.locator('.vela-sky-path__unknown').count()).toBeGreaterThan(0)
  await expect(sky.getByText(/Hatched gaps have no known horizon height/)).toBeVisible()
  await page.goto(primitiveUrl('&prop.horizon=uncalibrated'))
  await expect(sky.locator('.vela-sky-path__status')).toContainText('Provisional horizon')
  await expect(sky.getByText(/does not measure wire clearance/)).toBeVisible()
})

test('a target below the horizon and an unavailable path do not show a selected sky position', async ({
  page,
}) => {
  await page.goto(primitiveUrl('&prop.target=low-target&prop.selectedIndex=0'))
  const sky = page.locator('.vela-sky-path-specimen')
  await expect(sky.getByText('Below the geometric horizon', { exact: true })).toBeVisible()
  await expect(sky.locator('.vela-sky-path__selected')).toHaveCount(0)
  await page.goto(primitiveUrl('&prop.empty=true'))
  await expect(sky.getByText('No path samples available', { exact: true })).toBeVisible()
  await expect(sky.getByRole('slider')).toBeDisabled()
  await expect(sky.locator('.vela-sky-path__selected')).toHaveCount(0)
})

for (const width of [1040, 390]) {
  test(`expanded sky shares time and margin with the compact view at ${width}px`, async ({
    page,
  }) => {
    await page.goto(
      `/?component=panel&specimen=panel-target-framing&profile=vela-current&mode=dark&context=isolated&viewport=${width}&prop.screen=compose&prop.horizon=local`,
    )
    const demo = page.locator('.vela-target-demo')
    const compactTime = demo.getByRole('slider', { name: 'Preview time for Hercules Cluster' })
    const expand = demo.getByRole('button', { name: 'Expand sky view' })
    await expand.click()
    const dialog = page.getByRole('dialog', { name: 'Hercules Cluster · Through the night' })
    await expect(dialog).toBeVisible()
    const expandedTime = dialog.getByRole('slider', { name: 'Preview time for Hercules Cluster' })
    await expandedTime.focus()
    await expandedTime.press('ArrowRight')
    const margin = dialog.getByRole('slider', { name: /Elevation margin/ })
    await margin.focus()
    await margin.press('ArrowRight')
    await expect(dialog.locator('.vela-sky-path__moon-status')).toContainText('68% illuminated')
    await expect(dialog.locator('.vela-sky-path__moon-status')).toHaveText(
      await demo.locator('.vela-sky-path__moon-status').innerText(),
    )
    await expect(expandedTime).toHaveValue('19')
    await expect(margin).toHaveValue('4')
    await expect(page).toHaveURL(/prop.skyIndex=19/)
    await expect(page).toHaveURL(/prop.skyMargin=4/)
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(compactTime).toHaveValue('19')
    await expect(demo.getByRole('slider', { name: /Elevation margin/ })).toHaveValue('4')
    await expect(expand).toBeFocused()
    expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await expand.click()
    await expect(dialog.locator('.vela-sky-path__moon-status')).toContainText('68% illuminated')
    await expect(dialog.locator('.vela-sky-path__moon-status')).toHaveText(
      await demo.locator('.vela-sky-path__moon-status').innerText(),
    )
    await expect(expandedTime).toHaveValue('19')
    await expect(margin).toHaveValue('4')
    await dialog.getByRole('button', { name: 'Close sky view' }).click()
    await expect(dialog).toHaveCount(0)
    await expect(expand).toBeFocused()
  })
}

test('Moon follows selected time, preserves missing data and sets below the dome', async ({
  page,
}) => {
  await page.goto(primitiveUrl())
  const sky = page.locator('.vela-sky-path-specimen')
  const time = sky.getByRole('slider', { name: 'Preview time for Andromeda' })
  const moon = sky.locator('.vela-sky-path__moon')
  const readout = sky.locator('.vela-sky-path__moon-status')
  await expect(readout).toContainText('68% illuminated')
  await expect(readout).toContainText('from target')
  const initialPosition = await moon.getAttribute('transform')
  await time.fill('24')
  await expect(moon).not.toHaveAttribute('transform', initialPosition!)
  await time.fill('48')
  await expect(moon).toHaveCount(0)
  await expect(readout).toContainText('Moon below horizon')
  await page.goto(primitiveUrl('&prop.moon=unavailable'))
  await expect(readout).toHaveText('Moon position unavailable')
  await expect(moon).toHaveCount(0)
  await page.goto(primitiveUrl('&prop.moon=none'))
  await expect(readout).toHaveCount(0)
  await page.goto(primitiveUrl('&prop.empty=true'))
  await expect(moon).toHaveCount(0)
})
