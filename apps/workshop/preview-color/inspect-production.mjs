import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'

const base = 'http://127.0.0.1:5193'

const rig = '348c775f-d075-4cfe-90a3-b8e74d84b244'

const prefix = `/rigs/${rig}/observe`

const output = new URL('../.local/preview-adoption/evidence/', import.meta.url)

const hash = bytes => createHash('sha256').update(bytes).digest('hex')

await mkdir(output, { recursive: true })

const browser = await chromium.launch({ headless: true })

const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true })

const errors = []

page.on('pageerror', error => errors.push(error.message))

const evidence = []

async function loadedImage() {
  await page.waitForFunction(() => [...document.querySelectorAll('img')].some(image => image.src.includes('/saved-images/') && image.complete && image.naturalWidth > 0), undefined, { timeout: 120_000 })
}

try {
  const manifest = JSON.parse(await readFile(new URL('../.local/preview-color/manifest.json', import.meta.url), 'utf8'))

  for (const fixture of manifest.fixtures) {
    if (fixture.key === 'starfield') continue
    await page.goto(`${base}${prefix}/saved-images/${fixture.id}`)
    await loadedImage()
    const view = await (await page.request.get(`${base}/api/web/rigs/${rig}/saved-images/${fixture.id}`)).json()
    assert.equal(view.image.previewRendering.status, 'current')
    const original = await (await page.request.get(`${base}${view.image.fitsUrl}`)).body()
    assert.equal(hash(original), fixture.sha256)
    const native = await (await page.request.get(`${base}${view.image.imageUrl}`)).body()
    const approved = await readFile(new URL(`../.local/preview-color/${fixture.key}-neutral-native.png`, import.meta.url))
    assert.equal(hash(native), hash(approved), `${fixture.key}: production differs from approved B`)
    const fit = await (await page.request.get(`${base}${view.image.fitImageUrl}`)).body()
    assert.equal(hash(fit), hash(await readFile(new URL(`../.local/preview-color/${fixture.key}-neutral-fit.png`, import.meta.url))))
    const downloadEvent = page.waitForEvent('download')
    await page.getByRole('link', { name: 'Download preview', exact: true }).click()
    const download = await downloadEvent
    assert.equal(hash(await readFile(await download.path())), hash(native))
    await page.screenshot({ path: new URL(`${fixture.key}-saved-fit-desktop.png`, output).pathname, fullPage: true })
    await page.getByRole('button', { name: '100%', exact: true }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('img')].some(image => image.src.endsWith('/background-v1/preview') && image.complete && image.naturalWidth === 6248))
    await page.screenshot({ path: new URL(`${fixture.key}-saved-native-desktop.png`, output).pathname, fullPage: true })
    evidence.push({
      fixture: fixture.key,
      originalSha256: hash(original),
      approvedNativeSha256: hash(native),
      approvedFitSha256: hash(fit),
      downloadMatchesDisplay: true
    })
  }

  await page.goto(`${base}${prefix}/saved-images/unsupported-review-fixture`)
  await page.getByText('Preview refresh is unavailable.', { exact: false }).waitFor()
  await loadedImage()
  await page.screenshot({ path: new URL('unsupported-original.png', output).pathname, fullPage: true })

  // Actual production capture routes/controller, with the read-only retained-frame camera injected by the review runtime.
  await page.goto(`${base}${prefix}/capture`)
  const response = await page.request.post(`${base}/api/rigs/${rig}/capture/start`, { data: { exposureSeconds: 180, repeat: false, saveFrames: true } })
  assert.equal(response.status(), 200)
  await expect.poll(async () => {
    const state = await (await page.request.get(`${base}/api/web/rigs/${rig}/capture`)).json()

    return state.phase === 'complete' && state.latestImage?.saved
  }, { timeout: 120_000, intervals: [250, 500] }).toBe(true)
  const capture = await (await page.request.get(`${base}/api/web/rigs/${rig}/capture`)).json()
  const sourceView = await (await page.request.get(`${base}/api/web/rigs/${rig}/saved-images/47d1a817-c7a6-4498-b064-ab29fb80e5ec`)).json()
  assert.deepEqual(capture.latestImage.statistics, sourceView.image.statistics)
  const freshNative = await (await page.request.get(`${base}${capture.latestImage.imageUrl}`)).body()
  const cooled = await readFile(new URL('../.local/preview-color/cooled-neutral-native.png', import.meta.url))
  assert.equal(hash(freshNative), hash(cooled))
  const freshDisplayUrl = new URL(capture.latestImage.fitImageUrl ?? capture.latestImage.imageUrl, base).href
  await page.waitForFunction(expectedUrl => [...document.querySelectorAll('img')].some(image => image.src === expectedUrl && image.complete && image.naturalWidth > 0), freshDisplayUrl, { timeout: 120_000 })
  await page.screenshot({ path: new URL('new-replayed-capture.png', output).pathname, fullPage: true })
  const savedFresh = await (await page.request.get(`${base}/api/web/rigs/${rig}/saved-images/${capture.latestImage.id}`)).json()
  assert.equal(savedFresh.image.previewRendering.status, 'current')
  assert.equal(hash(await (await page.request.get(`${base}${savedFresh.image.previewDownloadUrl}`)).body()), hash(freshNative))

  await page.goto(`${base}${prefix}/saved-images`)
  await loadedImage()
  await page.screenshot({ path: new URL('collection-desktop.png', output).pathname, fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${base}${prefix}/saved-images/47d1a817-c7a6-4498-b064-ab29fb80e5ec`)
  await loadedImage()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: new URL('cooled-saved-phone.png', output).pathname, fullPage: true })
  assert.deepEqual(errors, [])
  await writeFile(new URL('production-results.json', output), JSON.stringify({
    evidence,
    freshCaptureId: capture.latestImage.id,
    freshCaptureMatchesApprovedB: true,
    statisticsUnchanged: capture.latestImage.statistics,
    errors
  }, null, 2))
  console.log(JSON.stringify({ checkedRetained: evidence.length, freshCaptureId: capture.latestImage.id, errors }, null, 2))
} catch (error) {
  console.error('Failed URL:', page.url(), errors)
  await page.screenshot({ path: new URL('failure.png', output).pathname, fullPage: true })
  throw error
} finally {
  await browser.close()
}
