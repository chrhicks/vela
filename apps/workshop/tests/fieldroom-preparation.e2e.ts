import { expect, test } from '@playwright/test'

const url = (
  kind: 'polar-alignment' | 'autofocus',
  width: number,
  phase: string,
  mode = 'light',
) =>
  `/?component=panel&specimen=panel-${kind}&profile=fieldroom&mode=${mode}&context=isolated&viewport=${width + 66}&prop.phase=${phase}`

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 2200, height: 1500 })
  await page.route('**/__workshop/**', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({ session: null, profiles: [] }),
    }),
  )
})

for (const mode of ['light', 'dark']) {
  for (const phase of ['adjusting', 'reconnecting']) {
    test(`alignment ${phase} phone geometry and inspection ${mode}`, async ({
      page,
    }) => {
      await page.goto(url('polar-alignment', 390, phase, mode))
      await page.evaluate(() => document.fonts.ready)
      const demo = page.locator('.vela-polar-demo')
      const bounds = await demo.boundingBox()

      if (!bounds) throw new Error('Missing specimen')
      const image = await demo.locator('.vela-polar-image-canvas').boundingBox()
      expect(image?.width).toBe(350)
      expect(image?.height).toBe(196)
      expect(image!.y - bounds.y).toBe(260)

      const stop = demo.getByRole('button', {
        name: phase === 'adjusting' ? 'Stop' : 'Stop session',
        exact: true,
      })

      const action = await stop.boundingBox()
      expect(action!.y + action!.height - bounds.y).toBeLessThanOrEqual(782)
      await demo.screenshot({
        path: `test-results/fieldroom-polar-${phase}-${mode}.png`,
      })
      await demo.getByRole('button', { name: 'Enlarge image' }).click()
      const dialog = demo.getByRole('dialog')
      await expect(dialog).toContainText('camera-reported start')
      await expect(dialog).toContainText('4′ minimum vertical field')
      await dialog.getByRole('button', { name: '100%', exact: true }).click()
      await expect(dialog.getByRole('region')).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(
        demo.getByRole('button', { name: 'Enlarge image' }),
      ).toBeFocused()

      if (phase === 'adjusting') {
        await demo
          .getByRole('button', { name: 'Appearance', exact: true })
          .click()
        const panel = demo.getByRole('dialog', { name: 'Appearance' })
        await expect(panel).toBeVisible()
        await panel.evaluate((element) =>
          Promise.all(
            element.getAnimations().map((animation) => animation.finished),
          ),
        )
        await demo.screenshot({
          path: `test-results/fieldroom-polar-appearance-${mode}.png`,
        })
        await page.keyboard.press('Escape')
        await expect(stop).toBeEnabled()
      }
    })
  }

  for (const width of [390, 1440]) {
    test(`autofocus walking source geometry ${width} ${mode}`, async ({
      page,
    }) => {
      await page.goto(url('autofocus', width, 'sampling', mode))
      await page.evaluate(() => document.fonts.ready)
      const demo = page.locator('.vela-af-demo')
      const bounds = await demo.boundingBox()

      if (!bounds) throw new Error('Missing specimen')
      expect(bounds.width).toBe(width)

      const chart = demo
        .getByRole('img', {
          name: 'Autofocus V-curve of focuser position versus star HFR',
        })
        .filter({ visible: true })

      await expect(chart.locator('.vela-af-point')).toHaveCount(5)
      await expect(chart.locator('.vela-af-hyperbola')).toHaveCount(0)
      await expect(demo).toContainText('32,792')

      if (width === 1440) {
        const box = await demo.locator('.vela-af-chart-panel').boundingBox()
        expect(box!.width).toBe(888)
        expect(box!.height).toBe(540)
        expect(box!.x - bounds.x).toBe(36)
        expect(box!.y - bounds.y).toBe(184)
        await expect(chart).toContainText('Start 32,842')
      } else {
        const box = await chart.boundingBox()
        expect(box!.width).toBe(320)
        expect(box!.height).toBe(146)

        const stop = await demo
          .getByRole('button', { name: 'Stop and restore start' })
          .filter({ visible: true })
          .boundingBox()

        expect(stop!.y + stop!.height - bounds.y).toBeLessThanOrEqual(782)
      }

      await demo.screenshot({
        path: `test-results/fieldroom-autofocus-${width}-${mode}.png`,
      })
    })
  }
}

test('autofocus setup and outcomes keep measurement and restore semantics', async ({
  page,
}) => {
  for (const phase of [
    'setup',
    'interrupted',
    'offline',
    'complete',
    'restored',
    'travel-limit',
    'restore-unconfirmed',
  ]) {
    await page.goto(url('autofocus', 1440, phase))
    const demo = page.locator('.vela-af-demo')
    await expect(demo).toBeVisible()
    await page.evaluate(() => document.fonts.ready)

    if (phase === 'setup')
      await expect(demo.locator('.vela-af-ready')).toHaveCSS('height', '96px')

    if (phase === 'interrupted') {
      await expect(demo).toContainText('same exposure')
      await expect(
        demo
          .getByRole('button', { name: 'Stop and restore start' })
          .filter({ visible: true }),
      ).toBeEnabled()
    }

    if (phase === 'offline')
      await expect(
        demo
          .getByRole('button', { name: 'Stop and restore start' })
          .filter({ visible: true }),
      ).toBeDisabled()

    if (phase === 'complete') {
      await expect(demo).not.toContainText('Waiting for the next sample')
      await expect(demo).not.toContainText('Stop requests a return')
      await expect(demo).toContainText('32,788')
      await expect(demo).toContainText('32,792')
    }

    if (phase === 'travel-limit') {
      await expect(demo).toContainText('150')
      await expect(demo).toContainText('-50 – 350')
      await expect(demo).not.toContainText('32,842')
    }

    if (phase === 'restore-unconfirmed')
      await expect(demo).toContainText('Vela did not repeat the move')
    await demo.screenshot({
      path: `test-results/fieldroom-autofocus-${phase}.png`,
    })
  }

  await page.goto(url('autofocus', 390, 'sampling'))
  const demo = page.locator('.vela-af-demo')
  await demo
    .getByRole('button', { name: 'Stop and restore start' })
    .filter({ visible: true })
    .click()
  await expect(demo).toContainText('Restoring start…')
  await expect(
    demo
      .getByRole('button', { name: 'Back to setup' })
      .filter({ visible: true }),
  ).toBeVisible()
  await expect(demo).toContainText('Start position restored')
})

test('alignment desktop extension and baseline preserve physical preparation', async ({
  page,
}) => {
  for (const width of [390, 768, 1440]) {
    for (const phase of [
      'setup',
      'point-2',
      'baseline-no-solution',
      'adjusting',
    ]) {
      await page.goto(
        `${url('polar-alignment', width, phase)}&prop.mode=physical`,
      )
      await page.evaluate(() => document.fonts.ready)
      const demo = page.locator('.vela-polar-demo')
      await expect(demo).toBeVisible()
      expect(
        await demo.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true)

      if (phase === 'setup')
        await expect(demo).toContainText('120° total westward travel')

      if (phase === 'point-2' && width === 390) {
        const root = await demo.boundingBox()

        const stop = await demo
          .getByRole('button', { name: 'Stop measurement' })
          .boundingBox()

        expect(stop!.y + stop!.height - root!.y).toBeLessThanOrEqual(782)
      }

      if (phase === 'baseline-no-solution')
        await expect(demo.locator('[data-marker]')).toHaveCount(0)
      await demo.screenshot({
        path: `test-results/fieldroom-polar-${width}-${phase}.png`,
      })
    }
  }
})

for (const mode of ['light', 'dark']) {
  for (const phase of ['setup', 'travel-limit']) {
    test(`autofocus compact planned window ${phase} ${mode}`, async ({ page }) => {
      await page.goto(url('autofocus', 390, phase, mode))
      await page.evaluate(() => document.fonts.ready)
      const demo = page.locator('.vela-af-demo')
      const diagram = demo.locator('.vela-af-window:visible')
      await expect(diagram).toHaveAttribute('viewBox', '0 0 320 120')
      const box = await diagram.boundingBox()
      expect(box?.width).toBe(320)
      expect(box?.height).toBe(120)

      const sizes = await diagram.locator('text').evaluateAll((labels) =>
        labels.map((label) => parseFloat(getComputedStyle(label).fontSize)),
      )

      expect(sizes.every((size) => size >= 14)).toBe(true)
      await expect(diagram).toContainText('Current / start')
      await expect(diagram).toContainText('First sample')
      await expect(diagram).toContainText(phase === 'setup' ? '32,842' : '150')
      await expect(diagram).toContainText(phase === 'setup' ? '33,042' : '350')
      await expect(diagram).toContainText(phase === 'setup' ? '32,642' : '-50')
      await demo.screenshot({
        path: `test-results/fieldroom-autofocus-compact-${phase}-${mode}.png`,
      })
    })
  }
}
