import { expect, test } from '@playwright/test'
import { isTargetDiscovery } from '../src/features/targets/validation'
import { writeFileSync } from 'node:fs'
import { openExploreScene } from './fixtures/fieldroom/browser'
import { reviewFraming } from './fixtures/fieldroom/explore'
import { reviewTimezone } from './fixtures/fieldroom/tonight'

test.use({ timezoneId: reviewTimezone })

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`Explore ${mode} keeps three reference subjects and real selection actions at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 782 })
      const { scene } = await openExploreScene(page, `explore-${mode}`)
      await expect(page.getByRole('heading', { name: 'Explore the sky' })).toBeVisible()
      await expect(page.getByRole('main')).toHaveCount(1)
      await expect(page.locator('.vela-discovery__card')).toHaveCount(3)
      await expect(page.locator('.vela-discovery__card img')).toHaveCount(3)
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.images).map((image) => image.decode()))
        await Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
            .map((animation) => animation.finished.catch(() => {})),
        )
      })

      const geometry = await page.evaluate(() =>
        Object.fromEntries(
          [
            ['header', '.vela-discovery__header'],
            ['controls', '.vela-discovery__controls'],
            ['cards', '.vela-discovery__grid'],
            ['card', '.vela-discovery__card'],
            ['photograph', '.vela-discovery__image'],
            ['summary', '.vela-discovery__subject'],
            ['trace', '.vela-discovery__subject .tonight-sky__trace'],
            ['footer', '.vela-discovery__footer'],
          ].map(([name, selector]) => [
            name,
            document.querySelector(selector!)!.getBoundingClientRect().toJSON(),
          ]),
        ),
      )

      writeFileSync(
        `/tmp/vela-explore-${mode}-${width}-geometry.json`,
        JSON.stringify(geometry, null, 2),
      )

      if (width === 1440) {
        expect(geometry.controls.x).toBe(36)
        expect(geometry.controls.y).toBe(180)
        expect(geometry.controls.height).toBe(46)
        expect(geometry.cards.y).toBe(288)
        expect(geometry.photograph.height).toBe(226)
        expect(geometry.summary.x).toBeCloseTo(978, 0)
        expect(geometry.summary.y).toBe(250)
        expect(geometry.summary.width).toBeCloseTo(426, 0)
      }

      await page.screenshot({ path: `/tmp/vela-explore-${mode}-${width}.png`, fullPage: true })
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      await page.locator('.vela-discovery__card').nth(1).getByRole('button').click()
      await expect(page.locator('.vela-discovery__subject')).toContainText('Andromeda Galaxy')

      if (width === 390) await expect(page.locator('.vela-discovery__subject')).toBeFocused()
      expect(scene.commands).toEqual([])
      await page.getByRole('link', { name: 'Frame this subject' }).click()
      await expect(page).toHaveURL(/\/targets\/ngc0224/)
      expect(scene.commands).toEqual([])
    })
  }
}

test('rigless Explore can search and inspect with no rig API requests or sky claims', async ({
  page,
}) => {
  const { scene, requests } = await openExploreScene(page, 'explore-no-rig')
  await expect(page.getByRole('main')).toHaveCount(1)
  await expect(page.locator('.vela-discovery__card')).toHaveCount(3)
  await expect(page.getByText(/sky timing requires/i)).toBeVisible()
  await page.getByRole('searchbox').fill('M31')
  await expect(page.locator('.vela-discovery__card')).toHaveCount(1)
  await expect(page.getByRole('heading', { name: 'Andromeda Galaxy' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: /Slew|Check current frame/ })).toHaveCount(0)
  expect(requests.some((request) => /\/api\/(?:web\/)?rigs\//.test(request))).toBe(false)
  expect(scene.commands).toEqual([])
  expect(scene.unknownRequests).toEqual([])
})

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`Framing ${mode} renders actual Aladin from pinned DSS tiles and its own test preview at ${width}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 989 : 782 })
      const { scene, missingResources, requests } = await openExploreScene(page, `framing-${mode}`)
      await expect(page.getByRole('heading', { name: /Frame/ }).first()).toBeVisible()
      await expect(page.locator('.framing-exposure img')).toBeVisible()
      await expect(page.getByRole('link', { name: 'Continue to capture' })).toBeEnabled()
      await expect(page.locator('.aladin-container canvas').first()).toBeVisible()
      await expect(page.locator('.vela-target-footprint--actual')).toBeVisible()
      await expect
        .poll(() => requests.filter((request) => /Norder\d\/Dir/.test(request)).length)
        .toBeGreaterThan(0)
      await page.waitForLoadState('networkidle')
      await page.evaluate(async () => {
        await document.fonts.ready
        await Promise.all(Array.from(document.images).map((image) => image.decode()))
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      })

      const geometry = await page.evaluate(() =>
        Object.fromEntries(
          [
            ['heading', '.vela-target-heading'],
            ['layout', '.vela-target-layout'],
            ['surveyCard', '.vela-target-composition'],
            ['toolbar', '.vela-target-survey-toolbar'],
            ['survey', '.vela-target-field'],
            ['result', '.vela-target-result'],
            ['preview', '.framing-exposure .capture-image__window'],
            ['footer', '.vela-target-context'],
          ].map(([name, selector]) => [
            name,
            document.querySelector(selector!)!.getBoundingClientRect().toJSON(),
          ]),
        ),
      )

      writeFileSync(
        `/tmp/vela-framing-${mode}-${width}-geometry.json`,
        JSON.stringify(geometry, null, 2),
      )

      if (width === 1440) {
        expect(geometry.layout.x).toBe(36)
        expect(geometry.layout.y).toBe(180)
        expect(geometry.surveyCard.width).toBeCloseTo(888, 0)
        expect(geometry.result.x).toBeCloseTo(952, 0)
        expect(geometry.result.width).toBeCloseTo(452, 0)
        expect(geometry.toolbar.height).toBe(54)
        expect(geometry.survey.height).toBe(520)
        expect(geometry.preview.height).toBe(124)
      }

      await page.screenshot({ path: `/tmp/vela-framing-${mode}-${width}.png`, fullPage: true })
      writeFileSync(
        `/tmp/vela-framing-${mode}-${width}-resources.json`,
        JSON.stringify(
          requests.filter((request) => request.includes('/api/survey/')),
          null,
          2,
        ),
      )
      expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
        false,
      )
      expect(missingResources).toEqual([])
      expect(scene.commands).toEqual([])
      await page.getByRole('link', { name: 'Continue to capture' }).click()
      await expect(page).toHaveURL(/\/observe\?target=ngc6888/)
    })
  }
}

test('a newer unsolved exposure retains its own preview beside the older solved footprint', async ({
  page,
}) => {
  const { scene, requests } = await openExploreScene(page, 'framing-unsolved')
  await expect(page.locator('.framing-exposure img')).toBeVisible()
  await expect(page.locator('.framing-exposure')).toContainText('No solved position')
  await expect(page.getByRole('link', { name: 'Continue to capture' })).toHaveCount(0)
  expect(requests.some((request) => request.includes('/review-test-2/fit.png'))).toBe(true)
  expect(scene.commands).toEqual([])
})


test('a refreshed subject below the horizon is not described as above it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { scene } = await openExploreScene(page, 'explore-light')
  const altitude = page.locator('.vela-discovery__altitude')
  await expect(altitude).toContainText('above the horizon')
  await page.route('**/api/web/rigs/fra400/target-discovery?*', route => {
    const url = new URL(route.request().url())
    const result = scene.respond('GET', `${url.pathname}${url.search}`)
    const view = structuredClone(result.json)

    if (!isTargetDiscovery(view, 'fra400')) throw new Error('Invalid discovery fixture')
    view.targets[0]!.sky!.currentAltitudeDegrees = -12
    view.targets[0]!.opportunity!.currentAltitudeDegrees = -12
    view.targets[0]!.opportunity!.startsAt = '2026-09-30T03:00:00.000Z'
    view.targets[0]!.opportunity!.endsAt = '2026-09-30T06:00:00.000Z'

    return route.fulfill({ json: view })
  })
  await page.getByRole('button', { name: 'Update sky' }).click()
  await expect(altitude.locator('strong')).toHaveText('12°')
  await expect(altitude).toContainText('below the horizon at 21:43')
  await expect(page.locator('.vela-discovery__window').first()).toHaveText('Above 30° from 23:00 to 02:00')
  await page.screenshot({ path: '/tmp/vela-explore-below-horizon.png', fullPage: true })
  expect(scene.commands).toEqual([])
})

for (const width of [1280, 390]) {
  test(`empty framing instructions fit their preview at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 })
    await openExploreScene(page, 'framing-light')
    await page.route('**/api/web/rigs/fra400/framing', route => route.fulfill({ json: {
      ...reviewFraming,
      preview: null,
      actual: null,
      phase: 'idle',
      checkCurrent: false,
      canCenter: false,
    } }))
    await page.reload()
    const empty = page.locator('.framing-exposure .capture-image__empty')
    await expect(empty).toContainText('No test exposure yet')

    const bounds = await empty.evaluate(element => {
      const viewport = element.parentElement!.getBoundingClientRect()
      const content = element.getBoundingClientRect()
      const paragraph = element.querySelector('p')!.getBoundingClientRect()
      const input = document.querySelector('#framing-exposure-seconds')!.getBoundingClientRect()

      return { viewport: viewport.toJSON(), content: content.toJSON(), paragraph: paragraph.toJSON(), input: input.toJSON() }
    })

    expect(bounds.content.bottom).toBeLessThanOrEqual(bounds.viewport.bottom)
    expect(bounds.paragraph.bottom).toBeLessThan(bounds.viewport.bottom)
    expect(bounds.input.top).toBeGreaterThan(bounds.viewport.bottom)
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false)
  })
}
