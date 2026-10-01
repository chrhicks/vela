import { expect, test } from '@playwright/test'
import { openAlignmentScene } from './fixtures/fieldroom/browser'

for (const width of [390, 1440]) {
  test(`preparation navigation preserves one Appearance instance and source header at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 })
    const { scene } = await openAlignmentScene(page, 'appearance-phone-light')
    await expect(page.getByRole('heading', { name: 'Polar alignment', exact: true })).toBeVisible()
    const navigation = page.locator('.vela-navigation')
    const appearance = navigation.getByRole('button', { name: 'Appearance', exact: true })
    await expect(appearance).toHaveCount(1)

    if (width === 390) {
      await expect(
        navigation.getByRole('link', { name: '← Tonight', exact: true }),
      ).toHaveAttribute('href', '/rigs/fra400/observe/capture')
      await expect(navigation.getByRole('combobox')).toBeHidden()
      expect((await navigation.boundingBox())!.height).toBe(48)
    } else {
      await expect(navigation.getByRole('combobox')).toBeVisible()
      expect((await navigation.boundingBox())!.height).toBe(88)
    }

    await appearance.click()
    await page.getByRole('radio', { name: 'Dark', exact: true }).check()
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
    await page.getByRole('button', { name: 'Close appearance', exact: true }).click()
    await expect(appearance).toBeFocused()
    expect(scene.writes).toEqual([])
    expect(scene.unknownRequests).toEqual([])
  })
}

test('compact preparation keeps another rig’s capture reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 782 })
  const { scene } = await openAlignmentScene(page, 'alignment-phone-adjusting')
  await page.route('**/api/web/navigation', route =>
    route.fulfill({
      json: {
        rigs: [
          { id: 'fra400', name: 'Askar FRA 400' },
          { id: 'seestar', name: 'Seestar' },
        ],
        captures: [
          {
            rigId: 'seestar',
            rigName: 'Seestar',
            phase: 'exposing',
            active: true,
            captureReadState: 'current',
            completedCount: 4,
            elapsedSeconds: 12,
            exposureSeconds: 60,
            error: null,
          },
        ],
      },
    }),
  )
  const capture = page.getByRole('link', { name: /Seestar.*4 captured.*Open capture/ })
  await expect(capture).toBeVisible()
  await expect(capture).toHaveAttribute('href', '/rigs/seestar/observe/capture')
  const bounds = (await capture.boundingBox())!
  expect(bounds.y + bounds.height).toBeLessThan(160)
  await expect(page.getByRole('button', { name: 'Appearance', exact: true })).toHaveCount(1)
  expect(scene.writes).toEqual([])
})
