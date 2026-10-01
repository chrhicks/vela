import { expect, test } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'

const output = '/tmp/vela-equipment-workshop'

const url = (specimen: string, width: number, mode: string, props = '') =>
  `/?component=${specimen.includes('onboarding') ? 'dialog' : 'panel'}&specimen=fieldroom-${specimen}&profile=fieldroom&mode=${mode}&context=isolated&viewport=${width + 66}${props}`

test.beforeEach(async ({ page }) => {
  mkdirSync(output, { recursive: true })
  await page.setViewportSize({ width: 2400, height: 3800 })
  await page.route('**/__workshop/**', route => route.fulfill({
    contentType: 'application/json', body: JSON.stringify({ session: null, profiles: [] }),
  }))
})

for (const width of [1440, 900, 390]) {
  for (const mode of ['light', 'dark']) {
    test(`Equipment ${width} ${mode} geometry and disclosure`, async ({ page }) => {
      await page.goto(url('equipment', width, mode))
      const demo = page.getByRole('article', { name: 'Equipment product example' })
      await expect(demo).toBeVisible()
      await expect(demo.locator('.vela-navigation__brand')).toHaveCSS('font-size', '34px')
      await expect(demo.locator('.vela-navigation__brand')).toHaveCSS('text-decoration-line', 'none')
      await page.evaluate(() => document.fonts.ready)

      const geometry = await demo.evaluate(element => {
        const origin = element.getBoundingClientRect()

        const box = (selector: string) => {
          const rect = element.querySelector(selector)!.getBoundingClientRect()

          return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }
        }

        return {
          width: origin.width, height: origin.height, overflow: element.scrollWidth > element.clientWidth,
          readiness: box('.vela-equipment-demo__readiness'), devices: box('.vela-equipment-demo__devices'),
          row: box('.vela-equipment-demo__device'), setup: box('.vela-equipment-demo__setup'),
          preparation: box('.vela-equipment-demo__preparation'),
        }
      })

      expect(geometry.width).toBe(width)
      expect(geometry.overflow).toBe(false)

      if (width === 1440) {
        expect(geometry.height).toBeLessThanOrEqual(921)
        expect(geometry.readiness).toEqual({ x: 36, y: 182, width: 888, height: 106 })
        expect(geometry.row.height).toBe(100)
        expect(geometry.setup.x).toBe(952)
        expect(geometry.setup.width).toBe(452)
        expect(geometry.setup.height).toBe(679)
      } else {
        expect(geometry.readiness.x).toBe(20)
        expect(geometry.devices.y).toBeGreaterThan(geometry.readiness.y)
        expect(geometry.setup.y).toBeGreaterThan(geometry.devices.y)
        expect(geometry.preparation.y).toBeGreaterThan(geometry.setup.y)
      }

      await demo.screenshot({ path: `${output}/equipment-${width}-${mode}.png` })
      writeFileSync(`${output}/equipment-${width}-${mode}.json`, JSON.stringify(geometry, null, 2))
      const disclosure = demo.getByRole('button', { name: 'Show ZWO ASI2600MC Pro details' })
      await disclosure.click()
      await expect(demo.getByRole('button', { name: 'Hide ZWO ASI2600MC Pro details' })).toHaveAttribute('aria-expanded', 'true')
      await expect(demo.getByText('Cooler power', { exact: true })).toBeVisible()
      await expect(page).toHaveURL(/prop.expanded=main-camera/)
      expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await demo.screenshot({ path: `${output}/equipment-expanded-${width}-${mode}.png` })
      await demo.getByRole('button', { name: 'Hide ZWO ASI2600MC Pro details' }).click()
      const secondary = demo.locator('.vela-equipment-demo__rig-details')
      await secondary.locator('summary').click()
      await expect(secondary).toHaveAttribute('open', '')
      await expect(secondary.getByText('192.168.4.104:11111')).toBeVisible()
      expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
      await demo.screenshot({ path: `${output}/equipment-secondary-${width}-${mode}.png` })
      await secondary.locator('summary').click()
      await expect(secondary).not.toHaveAttribute('open')
    })

    for (const state of ['first-night', 'populated']) {
      test(`Home ${state} ${width} ${mode}`, async ({ page }) => {
        await page.goto(url('home', width, mode, `&prop.catalog=${state}`))
        const demo = page.getByRole('article', { name: 'Home product example' })
        await expect(demo).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await expect(demo.getByRole('link', { name: 'Tonight', exact: true })).toHaveCount(0)
        await expect(demo.getByRole('button', { name: 'Appearance', exact: true })).toBeVisible()
        expect(await demo.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        await demo.screenshot({ path: `${output}/home-${state}-${width}-${mode}.png` })
      })
    }

    for (const stage of ['review', 'address-invalid']) {
      test(`Onboarding ${stage} ${width} ${mode}`, async ({ page }) => {
        await page.goto(url('rig-onboarding', width, mode, `&prop.stage=${stage}${stage === 'address-invalid' ? '&prop.host=http%3A%2F%2F192.168.4.104' : ''}`))
        const host = page.locator('.vela-rig-onboarding-host')
        const dialog = page.getByRole('dialog')
        await expect(dialog).toBeVisible()
        await page.evaluate(() => document.fonts.ready)
        await page.getByRole('dialog').evaluate(async element => {
          await Promise.all(element.getAnimations().map(animation => animation.finished))
        })
        expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
        expect(await dialog.locator('.vela-rig-onboarding__content').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)

        const geometry = await dialog.evaluate(element => {
          const origin = element.closest('.vela-rig-onboarding-host')!.getBoundingClientRect()
          const rect = element.getBoundingClientRect()
          const field = element.querySelector('input')?.getBoundingClientRect()

          return {
            x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height,
            field: field && { x: field.x - origin.x, y: field.y - origin.y, width: field.width, height: field.height },
          }
        })

        expect(geometry.width).toBe(width === 390 ? 390 : 624)

        if (width === 390) {
          expect(geometry.x).toBe(0)
          expect(geometry.y).toBe(0)
          expect(geometry.height).toBe(782)
          expect(geometry.field?.width).toBe(350)
        }

        await host.screenshot({ path: `${output}/onboarding-${stage}-${width}-${mode}.png` })
        writeFileSync(`${output}/onboarding-${stage}-${width}-${mode}.json`, JSON.stringify(geometry, null, 2))
      })
    }
  }
}

test('compact address validation, review Back, cancellation and focus remain useful', async ({ page }) => {
  await page.goto(url('home', 390, 'light'))
  const add = page.getByRole('button', { name: 'Add a rig', exact: true })
  await add.click()
  await page.getByRole('button', { name: 'Enter address', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('textbox', { name: /^Host or IP address/ }).fill('http://192.168.4.104')
  await dialog.getByRole('button', { name: 'Find rig', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: /^Host or IP address/ })).toHaveAttribute('aria-invalid', 'true')
  await expect(dialog.getByRole('textbox', { name: /^Host or IP address/ })).toBeFocused()
  await dialog.getByRole('textbox', { name: /^Host or IP address/ }).fill('192.168.4.104')
  await dialog.getByRole('button', { name: 'Find rig', exact: true }).click()
  await dialog.getByRole('textbox', { name: 'Rig name', exact: true }).fill('My observatory')
  await dialog.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: /^Host or IP address/ })).toHaveValue('192.168.4.104')
  await dialog.getByRole('button', { name: 'Find rig', exact: true }).click()
  await expect(dialog.getByRole('textbox', { name: 'Rig name', exact: true })).toHaveValue('My observatory')

  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab')
    expect(await dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(add).toBeFocused()
})

for (const stage of ['address-unreachable', 'empty', 'forget', 'review-unconfirmed']) {
  for (const mode of ['light', 'dark']) {
    test(`Onboarding recovery ${stage} ${mode}`, async ({ page }) => {
      await page.goto(url('rig-onboarding', 390, mode, `&prop.stage=${stage}`))
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await page.evaluate(() => document.fonts.ready)

      if (stage === 'forget') {
        await expect(dialog.getByRole('button', { name: 'Cancel', exact: true }).last()).toBeFocused()
      }

      if (stage === 'review-unconfirmed') {
        await expect(dialog.getByRole('button', { name: 'Add rig', exact: true })).toBeDisabled()
        await expect(dialog.getByRole('button', { name: 'Check saved rig', exact: true })).toBeVisible()
      }

      await page.locator('.vela-rig-onboarding-host').screenshot({ path: `${output}/onboarding-${stage}-390-${mode}.png` })
    })
  }
}
