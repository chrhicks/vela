import { expect, test } from '@playwright/test'

const specimen = (props: string) =>
  `/?component=panel&specimen=panel-autofocus&profile=fieldroom&mode=dark&context=isolated&${props}`

test('a blocked window stays on setup with the command disabled', async ({
  page,
}) => {
  await page.goto(
    specimen(
      'prop.example=near-inward-limit&prop.phase=setup&prop.stepSize=50',
    ),
  )
  const demo = page.locator('.vela-af-demo')
  await expect(demo.getByRole('heading', { name: 'Autofocus' })).toBeVisible()
  await expect(
    demo.getByRole('heading', { name: 'Window does not fit' }),
  ).toBeVisible()
  await expect(
    demo.getByRole('button', { name: 'Window does not fit' }),
  ).toBeDisabled()
  await expect(demo.locator('.vela-af-facts')).toBeVisible()
  await expect(demo.locator('.vela-af-facts')).not.toContainText('0 in / 0 out')
  await expect(demo).toContainText('mechanical limits')
  await expect(demo).not.toContainText('Focus again')
  await expect(demo).not.toContainText('Points appear as each short lands')
  await expect(demo.locator('.vela-af-layout')).toHaveCount(0)
})

test('the travel-limit activity control stays on setup', async ({ page }) => {
  await page.goto(
    specimen(
      'prop.example=current-focus&prop.phase=travel-limit&prop.stepSize=50',
    ),
  )
  const demo = page.locator('.vela-af-demo')
  await expect(
    demo.getByRole('heading', { name: 'Window does not fit' }),
  ).toBeVisible()
  await expect(
    demo.getByRole('button', { name: 'Window does not fit' }),
  ).toBeDisabled()
  await expect(demo.getByLabel('Step size')).toBeVisible()
  await expect(demo.locator('.vela-af-layout')).toHaveCount(0)
})

test('stopping an interactive walk retains only its completed samples', async ({ page }) => {
  await page.goto(specimen('prop.phase=setup&prop.stepSize=50'))
  const demo = page.locator('.vela-af-demo')
  await demo.getByRole('button', { name: 'Start autofocus' }).click()
  const points = demo.locator('.vela-af-chart:visible .vela-af-point')
  await expect(points).toHaveCount(1)
  await demo.getByRole('button', { name: 'Stop and restore start' }).filter({ visible: true }).click()
  await expect(points).toHaveCount(1)
  await expect(demo.getByRole('heading', { name: 'Start position restored' })).toBeVisible()
  await expect(points).toHaveCount(1)
})
