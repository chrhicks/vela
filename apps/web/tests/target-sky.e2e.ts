import { expect, test } from '@playwright/test'
import type { TargetSkyPath, TargetView } from '@vela/model/web'
import { reviewFraming } from './fixtures/fieldroom/explore'

const start = Date.UTC(2026, 8, 8, 16)

const samples: TargetSkyPath['samples'] = Array.from({ length: 97 }, (_, index) => {
  let sunAltitudeDegrees: number

  if (index < 4) sunAltitudeDegrees = 10
  else if (index < 8) sunAltitudeDegrees = -3
  else if (index < 12) sunAltitudeDegrees = -6
  else if (index < 16) sunAltitudeDegrees = -12
  else if (index < 50) sunAltitudeDegrees = -18
  else sunAltitudeDegrees = 10

  return {
    at: new Date(start + index * 900_000).toISOString(),
    azimuthDegrees: (50 + index * 3) % 360,
    altitudeDegrees: 35 + 20 * Math.sin(index / 15),
    sunAltitudeDegrees,
    moon: {
      azimuthDegrees: (170 + index * 2) % 360,
      altitudeDegrees: 50 * Math.cos((index * Math.PI) / 48),
      illuminationFraction: 0.68,
      waxing: true,
    },
  }
})

const sky: TargetSkyPath = {
  observedAt: samples[18]!.at,
  startsAt: samples[0]!.at,
  endsAt: samples.at(-1)!.at,
  samples,
  currentMoonSeparationDegrees: 84,
  currentAzimuthDegrees: samples[18]!.azimuthDegrees,
  currentAltitudeDegrees: samples[18]!.altitudeDegrees,
  highestAltitudeDegrees: 55,
  aboveHorizonDuringDarkness: [{ startsAt: samples[13]!.at, endsAt: samples[50]!.at }],
}

const target: TargetView = {
  id: 'm31',
  name: 'Andromeda Galaxy',
  catalog: 'M31',
  constellation: null,
  kind: 'Galaxy',
  raDegrees: 10.6847,
  decDegrees: 41.269,
  sizeArcminutes: 178,
  minorSizeArcminutes: 63,
  thumbnailUrl: '/api/targets/m31/thumbnail',
  sky,
}

for (const width of [1440, 390]) {
  test(`real app sky inspection shares time and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const commands: string[] = []
    page.on('request', (request) => {
      if (request.method() !== 'GET') commands.push(request.url())
    })
    await page.route('**/api/web/rigs/rig-1/targets/m31', (route) =>
      route.fulfill({ json: target }),
    )
    await page.route('**/api/web/rigs/rig-1/framing', (route) => route.abort())
    await page.route('**/api/survey/**', (route) => route.abort())
    await page.goto('/rigs/rig-1/observe/targets/m31')
    const trigger = page.getByRole('button', { name: 'View sky path', exact: true })
    await trigger.click()
    const sidebar = page.getByRole('dialog')
    const time = sidebar.getByRole('slider', { name: 'Preview time for Andromeda Galaxy' })
    await expect(
      sidebar.getByText('Local obstructions not included', { exact: true }),
    ).toBeVisible()
    await expect(sidebar.locator('.vela-sky-path__moon-status')).toContainText('68% illuminated')

    for (const [index, phase] of [
      [0, 'Daylight'],
      [4, 'Civil twilight'],
      [8, 'Nautical twilight'],
      [12, 'Astronomical twilight'],
      [16, 'Astronomical darkness'],
    ] as const) {
      await time.fill(String(index))
      await expect(sidebar.locator('.vela-sky-path__light-status')).toHaveText(phase)
      await expect(time).toHaveAttribute('aria-valuetext', new RegExp(phase))
    }

    const colors = await sidebar
      .locator('.vela-sky-path__light-track')
      .evaluateAll((paths) => [...new Set(paths.map((path) => getComputedStyle(path).stroke))])

    expect(colors).toHaveLength(5)
    await expect(
      sidebar.locator('.vela-sky-path__light-track[data-light="night"]').first(),
    ).toHaveCSS('stroke', 'rgb(24, 140, 165)')
    await expect(sidebar.getByText(/Light boundaries approximate/)).toBeVisible()
    await time.fill('23')
    await page.keyboard.press('Escape')
    await expect(trigger).toBeFocused()
    await trigger.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('slider')).toHaveValue('23')
    await expect(dialog.locator('.vela-sky-path__light-status')).toHaveText('Astronomical darkness')
    await expect(page.locator('.vela-theme > main')).toHaveAttribute('inert', '')
    await dialog.getByRole('slider').fill('30')
    await expect(dialog.locator('.vela-sky-path__moon-status')).toHaveText('Moon below horizon')
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    )
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(page.locator('.vela-theme > main')).not.toHaveAttribute('inert', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await trigger.click()
    await expect(dialog.getByRole('slider')).toHaveValue('30')
    expect(commands).toEqual([])
  })
}

test('interrupted sky updates keep the selected time and label the old calculation', async ({
  page,
}) => {
  await page.clock.install()
  let interrupted = false
  await page.route('**/api/web/rigs/rig-1/targets/m31', (route) =>
    interrupted ? route.abort() : route.fulfill({ json: target }),
  )
  await page.route('**/api/web/rigs/rig-1/framing', (route) => route.abort())
  await page.route('**/api/survey/**', (route) => route.abort())
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await page.getByRole('button', { name: 'View sky path', exact: true }).click()
  const time = page.getByRole('slider', { name: 'Preview time for Andromeda Galaxy' })
  await time.fill('22')
  interrupted = true
  await page.clock.fastForward(61000)
  await expect(page.getByRole('dialog').getByText('Sky updates interrupted · last calculation shown.')).toBeVisible()
  await expect(time).toHaveValue('22')
  await expect(page.locator('.vela-sky-path__light-status')).toHaveText('Astronomical darkness')
  await expect(page.locator('.vela-sky-path__map').getByText('Last', { exact: true })).toBeVisible()
  await expect(page.locator('.vela-sky-path__map').getByText('Now', { exact: true })).toHaveCount(0)
})

test('missing site does not invent a sky or Moon', async ({ page }) => {
  await page.route('**/api/web/rigs/rig-1/targets/m31', (route) =>
    route.fulfill({ json: { ...target, sky: null } }),
  )
  await page.route('**/api/web/rigs/rig-1/framing', (route) => route.abort())
  await page.route('**/api/survey/**', (route) => route.abort())
  await page.goto('/rigs/rig-1/observe/targets/m31')

  await expect(page.getByText('Site unavailable · sky path unknown')).toBeVisible()
  await expect(page.locator('.vela-sky-path')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'View sky path' })).toHaveCount(0)
})

// Tonight links directly to sky inspection before the target request has finished.
test('sky deep link waits for target data and dismiss stays closed across refresh and reload', async ({ page }) => {
  await page.clock.install()
  let releaseTarget!: () => void
  const targetReady = new Promise<void>(resolve => { releaseTarget = resolve })
  let releaseFraming!: () => void
  const framingReady = new Promise<void>(resolve => { releaseFraming = resolve })
  let targetRequests = 0
  await page.route('**/api/web/rigs/rig-1/targets/m31', async route => {
    targetRequests += 1
    await targetReady
    await route.fulfill({ json: target })
  })
  await page.route('**/api/web/rigs/rig-1/framing', async route => {
    await framingReady
    await route.fulfill({ json: { ...reviewFraming, rigId: 'rig-1', preview: null, observedAt: new Date().toISOString() } })
  })
  await page.route('**/api/survey/**', route => route.abort())
  await page.goto('/rigs/rig-1/observe/targets/m31#sky')
  await expect.poll(() => targetRequests).toBeGreaterThan(0)
  await expect(page.getByRole('dialog')).toHaveCount(0)
  releaseTarget()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('slider')).toHaveValue('18')
  await dialog.getByRole('slider').focus()
  releaseFraming()
  await expect(page.getByText('ASI2600MC Pro', { exact: true })).toBeAttached()
  await expect(dialog.getByRole('slider')).toBeFocused()
  await dialog.getByRole('button', { name: 'Close sky view' }).click()
  await expect(dialog).toHaveCount(0)
  await expect(page).not.toHaveURL(/#sky$/)
  const previousTargetRequests = targetRequests

  await page.clock.fastForward(61000)
  await expect.poll(() => targetRequests).toBeGreaterThan(previousTargetRequests)
  await expect(dialog).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('button', { name: 'View sky path', exact: true })).toBeVisible()
  await expect(dialog).toHaveCount(0)
  await page.goto('/rigs/rig-1/observe/targets/m31#sky')
  await expect(dialog).toBeVisible()
})
