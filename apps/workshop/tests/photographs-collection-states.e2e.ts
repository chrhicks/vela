import { expect, test } from '@playwright/test'

for (const width of [1440, 390]) {
  for (const mode of ['light', 'dark']) {
    for (const state of ['loading', 'empty']) {
      test(`Photographs collection ${state} ${width} ${mode}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width: 2400, height: 3200 })
        await page.route('**/__workshop/**', route =>
          route.fulfill({ json: { session: null, profiles: [] } }),
        )
        await page.goto(
          `/?component=panel&specimen=fieldroom-photographs&profile=fieldroom&mode=${mode}&context=isolated&viewport=${width + 66}&prop.collection=${state}`,
        )
        const demo = page.locator('.vela-photographs-demo')

        const card = demo.getByRole('region', {
          name: 'Photographs collection state',
        })

        await expect(card).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await expect(
          card.getByRole('heading', {
            name:
              state === 'loading'
                ? 'Loading saved photographs'
                : 'No saved photographs yet',
            exact: true,
          }),
        ).toBeVisible()
        await expect(
          demo.locator('.vela-photographs-demo__viewer'),
        ).toHaveCount(0)
        await expect(
          demo.locator('.vela-photographs-demo__details'),
        ).toHaveCount(0)
        await expect(demo.locator('.vela-photographs-demo__jump')).toHaveCount(
          0,
        )
        await expect(demo.locator('img')).toHaveCount(0)
        await expect(demo).not.toContainText('12 saved images')

        const geometry = await card.evaluate(element => {
          const style = getComputedStyle(element)
          const title = getComputedStyle(element.querySelector('h2')!)

          const context = getComputedStyle(
            element.querySelector('.vela-photographs-demo__context')!,
          )

          const body = getComputedStyle(
            element.querySelector(
              '.vela-photographs-demo__collection-message',
            )!,
          )

          return {
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
            gap: style.gap,
            copyGap: getComputedStyle(
              element.querySelector('.vela-photographs-demo__collection-copy')!,
            ).gap,
            bodyMinHeight: body.minHeight,
            x:
              element.getBoundingClientRect().x -
              element.closest('.vela-photographs-demo')!.getBoundingClientRect()
                .x,
            padding: style.padding,
            border: style.borderTopWidth,
            radius: style.borderRadius,
            title: [title.fontSize, title.lineHeight],
            context: [
              context.fontSize,
              context.lineHeight,
              context.letterSpacing,
            ],
            body: [body.fontSize, body.lineHeight],
          }
        })

        expect(geometry).toEqual({
          width: width === 1440 ? 440 : 350,
          height: 294,
          gap: '16px',
          copyGap: '10px',
          bodyMinHeight: '72px',
          x: width === 1440 ? 36 : 20,
          padding: '24px',
          border: '1px',
          radius: '6px',
          title: ['24px', '30px'],
          context: ['12px', '16px', '1.2px'],
          body: ['16px', '24px'],
        })
        expect(
          await demo.evaluate(
            element => element.scrollWidth <= element.clientWidth,
          ),
        ).toBe(true)

        if (state === 'loading') {
          await expect(card).toHaveAttribute('aria-busy', 'true')
          await expect(card.getByRole('status')).toHaveText(
            'Loading photographs…',
          )
          await expect(card.getByRole('button')).toHaveCount(0)
        } else {
          await expect(card).toContainText(
            'Turn on Save frames before capturing, or use Keep to retain an exposure.',
          )

          const tonight = card.getByRole('button', {
            name: 'Open Tonight →',
            exact: true,
          })

          await expect(tonight).toHaveAttribute('data-tone', 'accent')
          expect((await tonight.boundingBox())!.height).toBe(46)
        }

        await demo.screenshot({
          path: `/tmp/vela-workshop-photographs-${state}-${width}-${mode}.png`,
          animations: 'disabled',
        })
      })
    }
  }
}
