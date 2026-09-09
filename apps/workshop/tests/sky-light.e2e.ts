import { expect, test } from '@playwright/test'

for (const mode of ['dark', 'light']) {
  test(`light windows keep phase names and colored paths aligned in ${mode} mode`, async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 1200 })
    await page.route('**/__workshop/**', route => route.fulfill({ json: { session: null, profiles: [] } }))
    await page.goto(`/?component=sky-path&specimen=sky-path-light-windows&profile=vela-current&mode=${mode}&context=isolated&viewport=390`)
    const sky = page.locator('.vela-sky-path-specimen')
    const slider = sky.getByRole('slider')
    await expect(sky.getByRole('status')).toHaveText('Nautical twilight')
    await expect(slider).toHaveAttribute('aria-valuetext', /Nautical twilight/)
    await slider.focus()
    await slider.press('ArrowLeft')
    await expect(sky.getByRole('status')).toHaveText('Civil twilight')
    await slider.press('Home')
    await expect(sky.getByRole('status')).toHaveText('Daylight')
    await page.goto(`/?component=sky-path&specimen=sky-path-light-windows&profile=vela-current&mode=${mode}&context=isolated&viewport=390&prop.target=andromeda&prop.selectedIndex=30`)
    await expect(sky.getByRole('status')).toHaveText('Astronomical darkness')
    const strokes = await sky.locator('.vela-sky-path__light-track').evaluateAll(paths => [...new Set(paths.map(path => getComputedStyle(path).stroke))])
    expect(strokes).toHaveLength(5)
    expect(await sky.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
    await sky.screenshot({ path: `/tmp/vela-sky-light-${mode}-390.png` })
    await page.goto(`/?component=sky-path&specimen=sky-path-light-windows&profile=vela-current&mode=${mode}&context=isolated&viewport=680&prop.selectedIndex=26`)
    await sky.screenshot({ path: `/tmp/vela-sky-light-${mode}-680.png` })
  })
}
