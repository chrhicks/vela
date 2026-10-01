import { expect, test } from '@playwright/test'
import { openPhotographsScene } from './fixtures/fieldroom/browser'
import { photographsBase } from './fixtures/fieldroom/photographs'
import { reviewTimezone } from './fixtures/fieldroom/tonight'

const collectionPath = '/api/web/rigs/fra400/saved-images'

test.use({ timezoneId: reviewTimezone })

function deferred() {
  let resolve!: () => void

  const promise = new Promise<void>(done => {
    resolve = done
  })

  return { promise, resolve }
}

for (const width of [1440, 390]) {
  for (const mode of ['light', 'dark'] as const) {
    for (const state of ['loading', 'empty'] as const) {
      test(`collection ${state} matches source card at ${width} ${mode}`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: width === 390 ? 782 : 900 })

        const { scene } = await openPhotographsScene(
          page,
          state === 'empty' ? 'photographs-empty' : `photographs-${mode}`,
        )

        const gate = deferred()

        if (state === 'loading') {
          await expect(
            page.getByRole('region', { name: 'Photograph library', exact: true }),
          ).toBeVisible()
          await page.route(`**${collectionPath}`, async route => {
            await gate.promise
            const response = scene.respond('GET', collectionPath)
            await route.fulfill({
              status: response.status,
              json: response.json,
            })
          })
          await page.goto(photographsBase)
        } else if (mode === 'dark') {
          await page
            .getByRole('button', { name: 'Appearance', exact: true })
            .click()
          await page.getByRole('radio', { name: 'Dark', exact: true }).check()
          await page.keyboard.press('Escape')
        }

        const card = page.getByRole('region', {
          name: 'Photographs collection state',
        })

        await expect(card).toBeVisible()
        await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
        await expect(
          page.getByRole('region', { name: 'Saved preview', exact: true }),
        ).toHaveCount(0)
        await expect(
          page.getByRole('region', { name: 'Exposure details', exact: true }),
        ).toHaveCount(0)
        await expect(page.locator('.photographs__jump')).toHaveCount(0)
        await expect(page.locator('.photographs img')).toHaveCount(0)
        await page.evaluate(() => document.fonts.ready)

        const geometry = await card.evaluate(element => {
          const style = getComputedStyle(element)
          const title = getComputedStyle(element.querySelector('h2')!)

          const context = getComputedStyle(
            element.querySelector('.photographs__context')!,
          )

          const body = getComputedStyle(
            element.querySelector('.photographs__collection-message')!,
          )

          return {
            width: element.getBoundingClientRect().width,
            height: element.getBoundingClientRect().height,
            x: element.getBoundingClientRect().x,
            padding: style.padding,
            border: style.borderTopWidth,
            radius: style.borderRadius,
            gap: style.gap,
            copyGap: getComputedStyle(
              element.querySelector('.photographs__collection-copy')!,
            ).gap,
            title: [title.fontSize, title.lineHeight],
            context: [
              context.fontSize,
              context.lineHeight,
              context.letterSpacing,
            ],
            body: [body.fontSize, body.lineHeight, body.minHeight],
          }
        })

        expect(geometry).toEqual({
          width: width === 1440 ? 440 : 350,
          height: 294,
          x: width === 1440 ? 36 : 20,
          padding: '24px',
          border: '1px',
          radius: '6px',
          gap: '16px',
          copyGap: '10px',
          title: ['24px', '30px'],
          context: ['12px', '16px', '1.2px'],
          body: ['16px', '24px', '72px'],
        })

        if (state === 'loading') {
          await expect(
            card.getByRole('heading', { name: 'Loading saved photographs' }),
          ).toBeVisible()
          await expect(card.getByRole('status')).toHaveText(
            'Loading photographs…',
          )
          await expect(card).toHaveAttribute('aria-busy', 'true')
          await expect(page.locator('.photographs__heading')).not.toContainText(
            'saved images',
          )
        } else {
          await expect(
            card.getByRole('heading', { name: 'No saved photographs yet' }),
          ).toBeVisible()
          await expect(card).toContainText(
            'Turn on Save frames before capturing, or use Keep to retain an exposure.',
          )
          await expect(card).toContainText('Askar FRA 400')

          const tonight = card.getByRole('link', {
            name: 'Open Tonight →',
            exact: true,
          })

          await expect(tonight).toHaveAttribute(
            'href',
            '/rigs/fra400/observe/capture',
          )
          await expect(tonight).toHaveAttribute('data-tone', 'accent')
          expect((await tonight.boundingBox())!.height).toBe(46)
          expect(scene.detailReads).toEqual([])
        }

        await page
          .getByRole('heading', { name: 'Photographs', exact: true })
          .click()
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true)
        await page.screenshot({
          path: `/tmp/vela-photographs-${state}-${width}-${mode}.png`,
          fullPage: true,
          animations: 'disabled',
        })
        gate.resolve()

        if (state === 'loading') {
          await expect(card).toHaveCount(0)
          await expect(
            page.getByRole('region', { name: 'Photograph library', exact: true }),
          ).toBeVisible()
        }

        expect(scene.unknownRequests).toEqual([])
      })
    }
  }
}

test('held collection leaves a directly selected photograph independent', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { scene } = await openPhotographsScene(page, 'photographs-light')
  const selected = scene.images()[0]!
  await page.goto(`${photographsBase}/${selected.id}`)

  const preview = page.getByRole('region', {
    name: 'Saved preview',
    exact: true,
  })

  await expect(preview.getByRole('img')).toHaveAttribute(
    'src',
    selected.fitImageUrl!,
  )
  const readsBefore = scene.detailReads.length
  const gate = deferred()
  let collectionReads = 0
  await page.route(`**${collectionPath}`, async route => {
    collectionReads++
    await gate.promise
    const response = scene.respond('GET', collectionPath)
    await route.fulfill({ status: response.status, json: response.json })
  })
  await page.goto(`${photographsBase}/${selected.id}`)

  const loading = page.getByText('Loading photographs…', { exact: true })
  await expect(loading).toBeVisible()
  await expect(preview.getByRole('img')).toHaveAttribute(
    'src',
    selected.fitImageUrl!,
  )
  await expect(
    page.getByRole('link', { name: 'Download original FITS ↓', exact: true }),
  ).toHaveAttribute('href', selected.fitsUrl)
  const heldDetailReads = scene.detailReads.slice(readsBefore)
  expect(heldDetailReads.length).toBeGreaterThan(0)
  expect(heldDetailReads.every(id => id === selected.id)).toBe(true)
  const heldCollectionReads = collectionReads
  expect(heldCollectionReads).toBeGreaterThan(0)
  await preview.getByRole('img').evaluate(element => element.setAttribute('data-held-collection', 'retained'))
  const pixelsBefore = await preview.getByRole('img').getAttribute('src')
  await page.screenshot({
    path: '/tmp/vela-photographs-loading-selected-1440-light.png',
    fullPage: true,
    animations: 'disabled',
  })
  gate.resolve()
  await expect(loading).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Night of/ })).toBeVisible()
  await expect(preview.getByRole('img')).toHaveAttribute('src', pixelsBefore!)
  await expect(page).toHaveURL(`${photographsBase}/${selected.id}`)
  expect(scene.detailReads.slice(readsBefore)).toEqual(heldDetailReads)
  expect(collectionReads).toBe(heldCollectionReads)
  await expect(preview.getByRole('img')).toHaveAttribute('data-held-collection', 'retained')
  expect(scene.unknownRequests).toEqual([])
})
