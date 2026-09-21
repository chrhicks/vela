import { expect, test } from '@playwright/test'
import type { TargetSkyPath, TargetView } from '@vela/model/web'

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
      altitudeDegrees: 50 * Math.cos(index * Math.PI / 48),
      illuminationFraction: .68,
      waxing: true,
    },
  }
})

const sky: TargetSkyPath = {
  observedAt: samples[18]!.at,
  startsAt: samples[0]!.at,
  endsAt: samples.at(-1)!.at,
  samples,
  currentAltitudeDegrees: samples[18]!.altitudeDegrees,
  highestAltitudeDegrees: 55,
  aboveHorizonDuringDarkness: [{ startsAt: samples[13]!.at, endsAt: samples[50]!.at }],
}

const target: TargetView = {
  id: 'm31',
  name: 'Andromeda Galaxy',
  catalog: 'M31',
  kind: 'Galaxy',
  raDegrees: 10.6847,
  decDegrees: 41.269,
  sizeArcminutes: 178,
  thumbnailUrl: '/api/targets/m31/thumbnail',
  sky,
}

for (const width of [1440, 390]) {
  test(`real app sky inspection shares time and restores focus at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const commands: string[] = []
    page.on('request', request => {
      if (request.method() !== 'GET') commands.push(request.url())
    })
    await page.route('**/api/web/rigs/rig-1/targets/m31', route => route.fulfill({ json: target }))
    await page.route('**/api/web/rigs/rig-1/framing', route => route.abort())
    await page.route('**/api/survey/**', route => route.abort())
    await page.goto('/rigs/rig-1/observe/targets/m31')
    const sidebar = page.locator('.vela-target-sky-context')
    const time = sidebar.getByRole('slider', { name: 'Preview time for Andromeda Galaxy' })
    await expect(sidebar.getByText('Local obstructions not included', { exact: true })).toBeVisible()
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

    const colors = await sidebar.locator('.vela-sky-path__light-track').evaluateAll(paths =>
      [...new Set(paths.map(path => getComputedStyle(path).stroke))],
    )

    expect(colors).toHaveLength(5)
    await expect(sidebar.locator('.vela-sky-path__light-track[data-light="night"]').first()).toHaveCSS('stroke', 'rgb(99, 214, 239)')
    await expect(sidebar.getByText(/Light boundaries approximate/)).toBeVisible()
    await time.fill('23')
    const expand = page.getByRole('button', { name: 'Expand sky view' })
    await expand.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('slider')).toHaveValue('23')
    await expect(dialog.locator('.vela-sky-path__light-status')).toHaveText('Astronomical darkness')
    await expect(page.locator('.vela-theme > main')).toHaveAttribute('inert', '')
    await dialog.getByRole('slider').fill('30')
    await expect(dialog.locator('.vela-sky-path__moon-status')).toHaveText('Moon below horizon')
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(time).toHaveValue('30')
    await expect(expand).toBeFocused()
    await expect(page.locator('.vela-theme > main')).not.toHaveAttribute('inert', '')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    expect(commands).toEqual([])
  })
}

test('interrupted sky updates keep the selected time and label the old calculation', async ({ page }) => {
  await page.clock.install()
  let interrupted = false
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => interrupted ? route.abort() : route.fulfill({ json: target }))
  await page.route('**/api/web/rigs/rig-1/framing', route => route.abort())
  await page.route('**/api/survey/**', route => route.abort())
  await page.goto('/rigs/rig-1/observe/targets/m31')
  const time = page.getByRole('slider', { name: 'Preview time for Andromeda Galaxy' })
  await time.fill('22')
  interrupted = true
  await page.clock.fastForward(61000)
  await expect(page.getByText('Sky updates interrupted · last calculation shown.')).toBeVisible()
  await expect(time).toHaveValue('22')
  await expect(page.locator('.vela-sky-path__light-status')).toHaveText('Astronomical darkness')
  await expect(page.locator('.vela-sky-path__map').getByText('Last', { exact: true })).toBeVisible()
  await expect(page.locator('.vela-sky-path__map').getByText('Now', { exact: true })).toHaveCount(0)
})

test('missing site does not invent a sky or Moon', async ({ page }) => {
  await page.route('**/api/web/rigs/rig-1/targets/m31', route => route.fulfill({ json: { ...target, sky: null } }))
  await page.route('**/api/web/rigs/rig-1/framing', route => route.abort())
  await page.route('**/api/survey/**', route => route.abort())
  await page.goto('/rigs/rig-1/observe/targets/m31')
  await expect(page.getByText('Site unavailable · sky path unknown')).toBeVisible()
  await expect(page.locator('.vela-sky-path')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Expand sky view' })).toHaveCount(0)
})
