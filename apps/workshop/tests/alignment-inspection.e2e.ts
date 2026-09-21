import { expect, test } from '@playwright/test'

// The workbench adds 32px canvas padding per side and a 1px preview border.
// Request the outer width that gives the specimen the actual phone/desktop width.
const url = (width: number, example = 'large-error', phase = 'adjusting') =>
  `/?component=panel&specimen=panel-polar-alignment&profile=vela-current&mode=dark&context=isolated&viewport=${width + 66}&prop.example=${example}&prop.phase=${phase}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1700, height: 1400 })
  await page.route('**/__workshop/**', route =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: null, profiles: [] }),
    }),
  )
})

for (const width of [390, 1040]) {
  test(`fit-both contains both markers; fine zoom is deliberate at ${width}px`, async ({
    page,
  }) => {
    for (const example of ['large-error', 'near-aligned', 'outside-image']) {
      await page.goto(url(width, example))
      const demo = page.locator('.vela-polar-demo')
      const image = demo.getByRole('img')
      await expect(demo.getByRole('button', { name: 'Fit both', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      )
      expect(await demo.evaluate(element => element.getBoundingClientRect().width)).toBe(width)

      const framing = await image.evaluate(element => {
        if (!(element instanceof SVGSVGElement)) throw new Error('Expected the inspection SVG')

        const box = element.viewBox.baseVal
        const markers = [...element.querySelectorAll('circle')]

        return (
          markers.length === 2 &&
          markers.every(marker => {
            const x = marker.cx.baseVal.value
            const y = marker.cy.baseVal.value

            return (
              x > box.x + box.width * 0.08 &&
              x < box.x + box.width * 0.92 &&
              y > box.y + box.height * 0.08 &&
              y < box.y + box.height * 0.92
            )
          })
        )
      })

      expect(framing).toBe(true)
      expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

      if (example === 'outside-image')
        await expect(demo).toContainText('Blank area has no image data')
      await demo.screenshot({ path: `test-results/alignment-${width}-${example}.png` })
      await demo.getByRole('button', { name: 'Fine · 1′', exact: true }).click()

      const fineHeight = await image.evaluate(element => {
        if (!(element instanceof SVGSVGElement)) throw new Error('Expected the inspection SVG')

        return element.viewBox.baseVal.height
      })

      expect(fineHeight).toBe(30)

      if (example === 'near-aligned')
        await expect(demo).not.toContainText('Markers outside this fine view')
      else await expect(demo).toContainText('Markers outside this fine view')
      await demo.screenshot({ path: `test-results/alignment-${width}-${example}-fine.png` })
    }
  })

  test(`baseline no-solution enlarges the same exposure and restores focus at ${width}px`, async ({
    page,
  }) => {
    await page.goto(url(width, 'large-error', 'baseline-no-solution'))
    const demo = page.locator('.vela-polar-demo')
    await expect(demo).toContainText('No solution · Exposure retained')
    const imageSource = await demo.locator('svg image').getAttribute('href')

    if (!imageSource) throw new Error('Baseline exposure must have an image source')

    await demo.getByRole('button', { name: 'Enlarge image' }).click()
    const dialog = demo.getByRole('dialog')
    await expect(dialog).toContainText('Same exposure · Started 8:25:49 PM')
    expect(
      await dialog.evaluate(element => element.getBoundingClientRect().width),
    ).toBeLessThanOrEqual(await demo.evaluate(element => element.clientWidth))
    await expect(dialog.locator('svg image')).toHaveAttribute('href', imageSource)
    await expect(dialog.locator('[data-marker]')).toHaveCount(0)
    await dialog.screenshot({ path: `test-results/alignment-${width}-baseline-expanded.png` })
    await dialog.getByRole('button', { name: '100%', exact: true }).click()
    const native = dialog.locator('.vela-polar-native img')
    await expect(native).toHaveAttribute('src', imageSource)
    expect(await native.evaluate(element => element.getBoundingClientRect().width)).toBe(1600)
    await dialog.getByRole('region').evaluate(element => {
      element.scrollLeft = 500
    })
    expect(await dialog.getByRole('region').evaluate(element => element.scrollLeft)).toBe(500)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(demo.getByRole('button', { name: 'Enlarge image' })).toBeFocused()
  })
}

test('retrying keeps last-known status beside the image, including enlargement', async ({
  page,
}) => {
  await page.goto(url(390, 'near-aligned', 'reconnecting'))
  const demo = page.locator('.vela-polar-demo')
  await expect(demo.locator('.vela-polar-inspection-status')).toHaveText(
    'Last known solve · 1 min 7 s ago · Retrying; pause adjustments',
  )
  await demo.screenshot({ path: 'test-results/alignment-390-retrying.png' })
  await demo.getByRole('button', { name: 'Enlarge image' }).click()
  await expect(demo.getByRole('dialog')).toContainText(
    'Last known solve · 1 min 7 s ago · Retrying; pause adjustments',
  )
})
