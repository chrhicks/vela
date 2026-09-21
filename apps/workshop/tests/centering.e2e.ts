import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'

const url = (width: number, scenario = 'flip') =>
  `/?component=panel&specimen=panel-centering&profile=vela-current&mode=dark&context=isolated&viewport=${width}&prop.scenario=${scenario}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1400 })
  await page.route('**/__workshop/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: null, profiles: [] }),
    }),
  )
  await page.clock.install()
  await page.clock.pauseAt(new Date())
})

async function advanceTo(page: Page, outcome: string) {
  const status = page.locator('.vela-centering-demo').getByRole('status')

  for (let step = 0; step < 25; step++) {
    const before = await status.innerText()

    if (before.includes(outcome)) return
    await page.clock.runFor(before.includes('Taking a') ? 20000 : 2500)
    // Let React commit each stage before advancing the next stage's timer.
    await expect(status).not.toHaveText(before)
  }

  await expect(status).toContainText(outcome)
}

for (const width of [1040, 390]) {
  test(`one request remeasures after a flip and refines to tolerance at ${width}px`, async ({
    page,
  }) => {
    await page.goto(url(width))
    const demo = page.locator('.vela-centering-demo')
    const measured = demo.locator('.vela-centering-measured')
    await demo.getByRole('button', { name: 'Center composition', exact: true }).click()
    await expect(demo.getByRole('status')).toContainText('Moving across the meridian')
    await expect(demo.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await advanceTo(page, 'Measuring the new framing')
    await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('42.4′')
    await expect(measured).toHaveAttribute('transform', /rotate\(0 /)
    await advanceTo(page, 'Flip complete')
    await expect(demo.getByRole('status')).toContainText('Flip complete')
    await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('86.4′')
    await expect(measured).toHaveAttribute('transform', /rotate\(180 /)
    await advanceTo(page, 'Correction 4 of at most 4')
    await advanceTo(page, 'Measuring the new framing')
    await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('2.38′')
    await expect(demo.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await advanceTo(page, 'Composition centered')
    await expect(demo.getByRole('status')).toContainText('Composition centered')
    await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('0.35′')
    await expect(demo.getByRole('button', { name: 'Stop', exact: true })).toHaveCount(0)
    await expect(demo.getByRole('listitem')).toHaveCount(5)
    expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  })
}

test('repeated worsening stops automatically, while a check makes no new correction', async ({
  page,
}) => {
  await page.goto(url(1040, 'worsens'))
  const demo = page.locator('.vela-centering-demo')
  await demo.getByRole('button', { name: 'Center composition', exact: true }).click()
  await advanceTo(page, 'Centering is not converging')
  await expect(demo.getByRole('status')).toContainText('Centering is not converging')
  await expect(demo.getByRole('listitem')).toHaveCount(3)
  await demo.getByRole('button', { name: 'Check current frame', exact: true }).click()
  await expect(demo.getByRole('status')).toContainText('Checking only')
  await advanceTo(page, 'Current frame measured')
  await expect(demo.getByRole('status')).toContainText('Current frame measured')
  await expect(demo.getByRole('listitem')).toHaveCount(3)
  await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('67.1′')
})

test('Stop preserves the last measurement, and changing scenario cancels pending playback', async ({
  page,
}) => {
  await page.goto(url(1040))
  const demo = page.locator('.vela-centering-demo')
  await demo.getByRole('button', { name: 'Center composition', exact: true }).click()
  await advanceTo(page, 'Taking a 20-second test exposure')
  await expect(demo.getByRole('status')).toContainText('Taking a 20-second test exposure')
  const activity = demo.locator('.vela-working-indicator')
  const shimmer = demo.locator('.vela-working-indicator__shimmer')
  await expect(activity).toBeVisible()
  expect(
    await shimmer.evaluate(element => getComputedStyle(element, '::after').animationName),
  ).toBe('vela-working')
  await page.clock.runFor(10000)
  await expect(demo.getByRole('status')).toContainText('Taking a 20-second test exposure')
  await expect(activity).toBeVisible()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  expect(
    await shimmer.evaluate(element => getComputedStyle(element, '::after').animationName),
  ).toBe('none')
  await expect(activity.getByText('Working', { exact: true })).toBeVisible()
  await demo.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(activity).toBeHidden()
  await page.clock.runFor(60000)
  await expect(demo.getByRole('status')).toContainText('Centering stopped')
  await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('42.4′')
  await expect(demo.getByRole('listitem')).toHaveCount(1)
  await expect(demo.getByText('East · changed', { exact: true })).toBeVisible()
  await demo.getByRole('button', { name: 'Check current frame', exact: true }).click()
  await expect(activity).toBeVisible()
  await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('42.4′')
  await expect(demo.locator('.vela-centering-measured')).toHaveAttribute('data-current', 'false')
  await advanceTo(page, 'Current frame measured')
  await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('86.4′')
  await expect(demo.locator('.vela-centering-measured')).toHaveAttribute(
    'transform',
    /rotate\(180 /,
  )
  await expect(demo.locator('.vela-centering-measured')).toHaveAttribute('data-current', 'true')
  await expect(demo.getByRole('listitem')).toHaveCount(1)
  await page.clock.runFor(60000)
  await expect(demo.getByRole('status')).toContainText('Current frame measured')
  // A subsequent interrupted check retains the last measured post-flip frame.
  await demo.getByRole('button', { name: 'Check current frame', exact: true }).click()
  await demo.getByRole('button', { name: 'Stop', exact: true }).click()
  await expect(demo.locator('.vela-centering-offset > strong')).toHaveText('86.4′')
  await expect(demo.locator('.vela-centering-measured')).toHaveAttribute(
    'transform',
    /rotate\(180 /,
  )
  await page.getByRole('button', { name: 'Reset example', exact: true }).click()
  await demo.getByRole('button', { name: 'Center composition', exact: true }).click()
  await page
    .getByRole('combobox', { name: 'Workshop scenario', exact: true })
    .selectOption('converges')
  await expect(page).toHaveURL(/prop.scenario=converges/)
  await page.clock.runFor(60000)
  await expect(demo.getByRole('status')).toContainText('Ready to center')
  await demo.getByRole('button', { name: 'Center composition', exact: true }).click()
  await advanceTo(page, 'Composition centered')
  await expect(demo.getByRole('status')).toContainText('Composition centered')
  await expect(demo.getByRole('listitem')).toHaveCount(4)
})

test('WorkingIndicator is discovered as stable and renders in both gallery modes', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/gallery')
  const card = page.locator('.gallery-card').filter({ hasText: 'Working indicator' })
  await expect(card.locator('.stability-label')).toHaveText('stable')

  for (const mode of ['light', 'dark']) {
    const indicator = card.locator(`[data-mode="${mode}"] .vela-working-indicator`)
    await expect(indicator).toBeVisible()
    await expect(indicator).toHaveAttribute('data-working', 'true')
  }

  expect(errors).toEqual([])
})
