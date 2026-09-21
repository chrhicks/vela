import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'

const base = 'http://127.0.0.1:5185'

const output = new URL('../.local/preview-color/evidence/', import.meta.url)

await mkdir(output, { recursive: true })

const browser = await chromium.launch({ headless: true })

const page = await browser.newPage({ viewport: { width: 1800, height: 2200 } })

const errors = []

page.on('pageerror', error => errors.push(error.message))

const results = []

try {
  for (const viewport of [1280, 390]) {
    for (const fixture of ['starfield', 'prefocus', 'warm', 'cooled', 'dark', 'trails']) {
      for (const scale of ['fit', 'native', 'thumbnail']) {
        const url = `${base}/?component=panel&specimen=panel-preview-color&profile=vela-current&mode=dark&context=isolated&viewport=${viewport}&prop.fixture=${fixture}&prop.scale=${scale}`
        await page.goto(url)
        const specimen = page.locator('.vela-preview-color')
        await specimen.locator('img').first().waitFor({ state: 'attached' })
        await page.waitForFunction(() => {
          const images = [...document.querySelectorAll('.vela-preview-color img')]

          return (
            images.length === 2 &&
            images.every(
              image =>
                image.complete && image.naturalWidth > 0 && image.style.visibility === 'visible',
            )
          )
        })

        const geometry = await specimen.evaluate(element => ({
          width: element.getBoundingClientRect().width,
          scrollWidth: element.scrollWidth,
          images: [...element.querySelectorAll('img')].map(image => ({
            native: image.naturalWidth,
            displayed: image.getBoundingClientRect().width,
          })),
        }))

        assert.ok(
          geometry.scrollWidth <= geometry.width + 1,
          `Overflow at ${fixture}/${scale}/${viewport}`,
        )
        assert.equal(geometry.images[0].native, scale === 'native' ? 6248 : 1562)

        if (scale === 'native') {
          assert.equal(geometry.images[0].displayed, 6248)
          await specimen
            .locator('.vela-preview-color__window')
            .first()
            .evaluate(element => {
              element.scrollLeft = 1234
              element.scrollTop = 567
            })
          await page.waitForFunction(() => {
            const windows = [...document.querySelectorAll('.vela-preview-color__window')]

            return windows.every(
              element => element.scrollLeft === 1234 && element.scrollTop === 567,
            )
          })
          await specimen.getByRole('button', { name: 'Center image' }).click()
        }

        await specimen.screenshot({
          path: new URL(`${fixture}-${scale}-${viewport}.png`, output).pathname,
        })
        results.push({ fixture, scale, viewport, geometry, url })
      }
    }
  }

  const missing = await page.request.get(`${base}/__preview-color/original.fits`)
  assert.equal(missing.status(), 404)
  const write = await page.request.post(`${base}/__preview-color/manifest.json`, { data: '{}' })
  assert.equal(write.status(), 404)
  assert.deepEqual(errors, [])
  await writeFile(
    new URL('browser-results.json', output),
    JSON.stringify({ results, errors, readOnlyRoutes: 'pass' }, null, 2),
  )
  console.log(
    `Inspected ${results.length} rendered comparisons; native panning, overflow, image identity and read-only routes passed.`,
  )
} catch (error) {
  console.error('Failed URL:', page.url(), errors)
  await page.screenshot({ path: new URL('failed-browser.png', output).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
