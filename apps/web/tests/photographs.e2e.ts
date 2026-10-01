import { expect, test, type Locator, type Page } from '@playwright/test'
import type { SavedImage } from '@vela/model/web'
import { writeFileSync } from 'node:fs'
import { openPhotographsScene } from './fixtures/fieldroom/browser'
import { photographsBase } from './fixtures/fieldroom/photographs'
import { reviewTimezone } from './fixtures/fieldroom/tonight'

test.use({ timezoneId: reviewTimezone })

const collectionPath = '/api/web/rigs/fra400/saved-images'

const preview = (page: Page) => page.getByRole('region', { name: 'Saved preview', exact: true })

const list = (page: Page) => page.getByRole('region', { name: 'Photographs list', exact: true })

const details = (page: Page) => page.getByRole('region', { name: 'Exposure details', exact: true })

const originalDownload = (page: Page) => page.getByRole('link', { name: /Download original FITS/ })

const displayDownload = (page: Page) => page.getByRole('link', { name: /Download (?:display|original preview) PNG/i })

function row(page: Page, id: string) {
  return list(page).locator(`a[href="${photographsBase}/${encodeURIComponent(id)}"]`)
}

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>(yes => { resolve = yes })

  return { promise, resolve }
}

async function settledRendering(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await Promise.all(Array.from(document.images)
      .filter(image => {
        const rect = image.getBoundingClientRect()

        return rect.top < innerHeight && rect.bottom > 0
      })
      .map(image => image.decode()))
    await Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function expectSelected(page: Page, image: SavedImage) {
  await expect(page).toHaveURL(new RegExp(`/saved-images/${image.id}$`))
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', image.fitImageUrl ?? image.imageUrl)
  await expect(originalDownload(page)).toHaveAttribute('href', image.fitsUrl)
  await expect(displayDownload(page)).toHaveAttribute('href', image.previewDownloadUrl)
  await expect(row(page, image.id)).toHaveAttribute('aria-current', /^(page|true)$/)
}

async function viewportPosition(viewport: Locator) {
  return viewport.evaluate(element => ({ left: element.scrollLeft, top: element.scrollTop }))
}

for (const mode of ['light', 'dark'] as const) {
  for (const width of [1440, 390]) {
    test(`Photographs ${mode} keeps the source composition and uncropped reference at ${width}`, async ({ page }) => {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 782 })
      const { scene } = await openPhotographsScene(page, `photographs-${mode}`)
      const image = scene.images()[0]!
      await expect(page.getByRole('heading', { name: 'Photographs', exact: true })).toBeVisible()
      await expect(page.getByRole('main')).toHaveCount(1)
      await expectSelected(page, image)
      await expect(list(page).getByRole('link')).toHaveCount(6)
      await expect(page.getByRole('button', { name: 'Show 6 earlier images', exact: true })).toBeVisible()
      await expect(details(page)).toContainText('180')
      await expect(details(page)).toContainText('1280 × 1224')
      await expect(details(page)).toContainText('842')
      await expect(preview(page)).toContainText('Image 12 of 12')
      await expect(page.locator('html')).toHaveAttribute('data-mode', mode)
      await expect(preview(page)).toHaveCount(1)
      await settledRendering(page)

      const geometry = {
        list: await list(page).boundingBox(),
        row: await list(page).getByRole('link').first().boundingBox(),
        viewer: await preview(page).boundingBox(),
        toolbar: await preview(page).locator('header').boundingBox(),
        viewport: await preview(page).locator('.capture-image__window').boundingBox(),
        image: await preview(page).getByRole('img').boundingBox(),
        details: await details(page).boundingBox(),
      }

      for (const box of Object.values(geometry)) expect(box).not.toBeNull()
      await expect(preview(page).getByRole('img')).toHaveCSS('object-fit', 'contain')
      expect(await preview(page).getByRole('img').evaluate(image => ({
        width: image instanceof HTMLImageElement ? image.naturalWidth : 0,
        height: image instanceof HTMLImageElement ? image.naturalHeight : 0,
      }))).toEqual({ width: 1280, height: 1224 })
      expect(geometry.image!.width).toBeLessThanOrEqual(geometry.viewport!.width + 1)
      expect(geometry.image!.height).toBeLessThanOrEqual(geometry.viewport!.height + 1)

      if (width === 1440) {
        expect(geometry.list!.x).toBe(36)
        expect(geometry.list!.width).toBe(260)
        expect(geometry.list!.y).toBe(172)
        expect(geometry.row!.height).toBe(85)
        expect(geometry.viewer!.x).toBe(320)
        expect(geometry.viewer!.width).toBe(736)
        expect(geometry.viewer!.height).toBe(644)
        expect(geometry.toolbar!.height).toBe(54)
        expect(geometry.viewport!.height).toBe(532)
        expect(geometry.details!.x).toBe(1080)
        expect(geometry.details!.width).toBe(324)
      } else {
        expect(geometry.viewer!.y).toBeLessThan(geometry.details!.y)
        expect(geometry.details!.y).toBeLessThan(geometry.list!.y)
      }

      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      writeFileSync(`/tmp/vela-photographs-${mode}-${width}-geometry.json`, JSON.stringify(geometry, null, 2))
      await page.screenshot({ path: `/tmp/vela-photographs-${mode}-${width}.png`, fullPage: true })
      expect(scene.unknownRequests).toEqual([])
    })
  }
}

test('newest canonical selection and Back/Forward keep the collection and expose each exact photograph', async ({ page }) => {
  await page.route('**/history-origin', route => route.fulfill({ contentType: 'text/html', body: '<title>History origin</title>' }))
  await page.goto('/history-origin')
  const { scene, requests } = await openPhotographsScene(page, 'photographs-light')
  const [newest, previous] = scene.images()
  await expectSelected(page, newest!)
  const collectionReads = requests.filter(request => request === `GET ${collectionPath}`).length
  await list(page).evaluate(element => element.setAttribute('data-collection-owner', 'retained'))
  await row(page, previous!.id).click()
  await expectSelected(page, previous!)
  await expect(preview(page)).toContainText('Image 11 of 12')
  await page.goBack()
  await expectSelected(page, newest!)
  await page.goForward()
  await expectSelected(page, previous!)
  await expect(list(page)).toHaveAttribute('data-collection-owner', 'retained')
  expect(requests.filter(request => request === `GET ${collectionPath}`)).toHaveLength(collectionReads)
  await page.goBack()
  await expectSelected(page, newest!)
  await page.goBack()
  await expect(page).toHaveURL(/\/history-origin$/)
})

test('earlier disclosure and Appearance preserve selected native pixels, pan and detail ownership', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { scene } = await openPhotographsScene(page, 'photographs-light')
  const selected = scene.images()[0]!
  await expectSelected(page, selected)
  await preview(page).getByRole('button', { name: '100%', exact: true }).click()
  const native = preview(page).getByRole('region', { name: /Image at 100 percent/ })
  await expect(native).toBeVisible()
  const initial = await viewportPosition(native)
  await native.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await viewportPosition(native)).left).toBe(initial.left + 80)
  const position = await viewportPosition(native)
  const pixels = await native.getByRole('img').getAttribute('src')
  const detailReads = [...scene.detailReads]
  const selectedUrl = page.url()
  await page.getByRole('button', { name: 'Show 6 earlier images', exact: true }).click()
  await expect(list(page).getByRole('link')).toHaveCount(12)
  await expect(page.getByRole('button', { name: /Show .* earlier images/ })).toHaveCount(0)
  expect(await list(page).evaluate(element => {
    const focused = document.activeElement

    return focused instanceof HTMLElement && element.contains(focused) && focused.matches('h1, h2, h3, h4, h5, h6, [role="heading"]') && focused.tabIndex === -1
  })).toBe(true)
  await expect(native.getByRole('img')).toHaveAttribute('src', pixels!)
  expect(await viewportPosition(native)).toEqual(position)
  expect(scene.detailReads).toEqual(detailReads)
  await page.getByRole('button', { name: 'Appearance', exact: true }).click()
  await page.getByRole('dialog', { name: 'Appearance', exact: true }).evaluate(element =>
    Promise.all(element.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))))
  await page.getByRole('radio', { name: 'Dark', exact: true }).check()
  await page.keyboard.press('Escape')
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark')
  await expect(native.getByRole('img')).toHaveAttribute('src', pixels!)
  await expect(preview(page).getByRole('button', { name: '100%', exact: true })).toHaveAttribute('aria-pressed', 'true')
  expect(await viewportPosition(native)).toEqual(position)
  expect(page.url()).toBe(selectedUrl)
  expect(scene.detailReads).toEqual(detailReads)
  await expect(displayDownload(page)).toHaveAttribute('href', selected.previewDownloadUrl)
})

test('an older direct link reveals its selected row across dates without opening neighboring details', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-older-link')
  const selected = scene.images().find(image => image.id === scene.selectedId)!
  await expectSelected(page, selected)
  await expect(row(page, selected.id)).toBeInViewport()
  expect(await list(page).getByRole('link').count()).toBeGreaterThanOrEqual(20)
  await expect(preview(page)).toContainText('Image 5 of 24')
  expect(scene.detailReads.length).toBeGreaterThan(0)
  expect(scene.detailReads.every(id => id === selected.id)).toBe(true)
})

test('a direct photograph remains usable while collection and rig telemetry fail, and collection retry preserves it', async ({ page }) => {
  const { scene, requests } = await openPhotographsScene(page, 'photographs-collection-failed')
  const selected = scene.images()[0]!
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', selected.fitImageUrl!)
  await expect(originalDownload(page)).toHaveAttribute('href', selected.fitsUrl)
  await expect(displayDownload(page)).toHaveAttribute('href', selected.previewDownloadUrl)
  await expect(page.getByRole('button', { name: 'Retry photographs', exact: true })).toBeVisible()
  await expect(preview(page)).not.toContainText(/Image \d+ of \d+/)
  await preview(page).getByRole('img').evaluate(element => element.setAttribute('data-direct-pixels', 'retained'))
  const detailReads = [...scene.detailReads]
  scene.setCollectionFailure(false)
  await page.getByRole('button', { name: 'Retry photographs', exact: true }).click()
  await expect(row(page, selected.id)).toHaveAttribute('aria-current', /^(page|true)$/)
  await expect(preview(page).getByRole('img')).toHaveAttribute('data-direct-pixels', 'retained')
  expect(scene.detailReads).toEqual(detailReads)
  expect(requests.every(request => request.startsWith('GET '))).toBe(true)
  expect(requests.some(request => /\/capture|\/imaging-camera|\/framing/.test(request))).toBe(false)
})

test('an explicit missing image never falls back to newest and another row remains usable', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-selected-missing')
  await expect(page.getByRole('button', { name: 'Retry selected photograph', exact: true })).toBeVisible()
  await expect(list(page).getByRole('link')).toHaveCount(6)
  await expect(page).toHaveURL(/\/saved-images\/missing-saved-image$/)
  await expect(preview(page).getByRole('img')).toHaveCount(0)
  await expect(originalDownload(page)).toHaveCount(0)
  expect(scene.detailReads.every(id => id === 'missing-saved-image')).toBe(true)
  const available = scene.images()[1]!
  await row(page, available.id).click()
  await expectSelected(page, available)
})

test('slow selected detail A cannot replace B after its response arrives late', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-light')
  await expectSelected(page, scene.images()[0]!)
  const slow = scene.images()[2]!
  const next = scene.images()[1]!
  const started = deferred()
  const release = deferred()
  const finished = deferred()
  await page.route(`**${collectionPath}/${slow.id}`, async route => {
    const response = scene.respond('GET', `${collectionPath}/${slow.id}`)
    started.resolve()
    await release.promise
    await route.fulfill({ status: response.status, json: response.json })
    finished.resolve()
  })
  await row(page, slow.id).click()
  await started.promise
  await expect(page).toHaveURL(new RegExp(`/saved-images/${slow.id}$`))
  await expect(preview(page).getByRole('img')).toHaveCount(0)
  await expect(originalDownload(page)).toHaveCount(0)
  await row(page, next.id).click()
  await expectSelected(page, next)
  await preview(page).getByRole('img').evaluate(element => element.setAttribute('data-selected-pixels', 'B'))
  release.resolve()
  await finished.promise
  await settledRendering(page)
  await expectSelected(page, next)
  await expect(preview(page).getByRole('img')).toHaveAttribute('data-selected-pixels', 'B')
})

test('opening one legacy photograph publishes only its matching display version and preserves original FITS', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-legacy')
  const id = scene.selectedId!
  const original = `/api/rigs/fra400/saved-images/${id}`
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', `${original}/previews/background-v1/fit`)
  await expect(displayDownload(page)).toHaveAttribute('href', `${original}/previews/background-v1/download-preview`)
  await expect(originalDownload(page)).toHaveAttribute('href', `${original}/fits`)
  expect(scene.images().filter(image => image.previewRendering?.status === 'current').map(image => image.id)).toEqual([id])
  expect(scene.detailReads.every(imageId => imageId === id)).toBe(true)
  await expect(list(page).getByRole('link')).toHaveCount(6)
  expect(scene.fileReads.filter(path => path.includes('/previews/background-v1/')).every(path => path.includes(`/${id}/`))).toBe(true)
})

test('unavailable refresh keeps original preview and exact downloads while explaining preserved FITS', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-fallback')
  const selected = scene.images()[0]!
  await expectSelected(page, selected)
  await expect(details(page)).toContainText(/original FITS/i)
  await expect(page.getByRole('link', { name: /original preview PNG/i })).toHaveAttribute('href', selected.previewDownloadUrl)
  await expect(originalDownload(page)).toHaveCount(1)
  expect(selected.previewRendering?.status).toBe('unavailable')
  expect(scene.fileReads.some(path => path.includes('/previews/'))).toBe(false)
  await expect(originalDownload(page)).toHaveAttribute('download', '')
  await expect(displayDownload(page)).toHaveAttribute('download', '')
  await settledRendering(page)
  await page.screenshot({ path: '/tmp/vela-photographs-fallback.png', fullPage: true })
})

test('failed native GET keeps the selected fitted pixels and retry reads only that same resource', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-native-failed')
  const selected = scene.images()[0]!
  await expectSelected(page, selected)
  await preview(page).getByRole('button', { name: '100%', exact: true }).click()
  await expect(preview(page).getByRole('button', { name: 'Retry full-resolution image', exact: true })).toBeVisible()
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', selected.fitImageUrl!)
  await expect(displayDownload(page)).toHaveAttribute('href', selected.previewDownloadUrl)
  await expect(originalDownload(page)).toHaveAttribute('href', selected.fitsUrl)
  scene.setPreviewFailure(selected.id, 'native', null)
  await preview(page).getByRole('button', { name: 'Retry full-resolution image', exact: true }).click()
  await expect(preview(page).getByRole('region', { name: /Image at 100 percent/ })).toBeVisible()
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', /^blob:/)
  await expect(preview(page).getByRole('img')).toHaveCSS('width', '1280px')
  expect(scene.fileReads.filter(path => path.endsWith('/preview'))).toEqual([selected.imageUrl, selected.imageUrl])
  await expect(displayDownload(page)).toHaveAttribute('href', selected.previewDownloadUrl)
})

test('a missing saved native preview is not described as camera-cache expiry or loss of original FITS', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-native-missing')
  const selected = scene.images()[0]!
  await expectSelected(page, selected)
  await preview(page).getByRole('button', { name: '100%', exact: true }).click()
  await expect.poll(() => scene.fileReads.includes(selected.imageUrl)).toBe(true)
  await expect(preview(page)).toContainText(/unavailable|not available|could not be loaded/i)
  await expect(preview(page)).not.toContainText(/camera cache|expired/i)
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', selected.fitImageUrl!)
  await expect(originalDownload(page)).toHaveAttribute('href', selected.fitsUrl)
})

test('fitted-preview failure leaves saved facts and FITS usable and retries without another detail read', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-fit-failed')
  const selected = scene.images()[0]!
  await expect(originalDownload(page)).toHaveAttribute('href', selected.fitsUrl)
  await expect(details(page)).toContainText('1280 × 1224')
  const retry = preview(page).getByRole('button', { name: /Retry (?:preview|image)/i })
  await expect(retry).toBeVisible({ timeout: 12_000 })
  const detailReads = [...scene.detailReads]
  scene.setPreviewFailure(selected.id, 'fit', null)
  await retry.click()
  await expect(preview(page).getByRole('img')).toHaveAttribute('src', selected.fitImageUrl!)
  expect(scene.detailReads).toEqual(detailReads)
})

test('detail retry is independent from the retained list and names the same selected image', async ({ page }) => {
  const { scene, requests } = await openPhotographsScene(page, 'photographs-detail-failed')
  const selected = scene.images()[0]!
  await expect(list(page).getByRole('link')).toHaveCount(6)
  const collectionReads = requests.filter(request => request === `GET ${collectionPath}`).length
  const retry = page.getByRole('button', { name: 'Retry selected photograph', exact: true })
  await expect(retry).toBeVisible()
  scene.setDetailFailure(selected.id, null)
  await retry.click()
  await expectSelected(page, selected)
  expect(scene.detailReads.every(id => id === selected.id)).toBe(true)
  expect(requests.filter(request => request === `GET ${collectionPath}`)).toHaveLength(collectionReads)
})

test('empty photographs offer Tonight without invented selection, preview facts or detail reads', async ({ page }) => {
  const { scene } = await openPhotographsScene(page, 'photographs-empty')
  await expect(page.getByRole('heading', { name: 'Photographs', exact: true })).toBeVisible()
  await expect(page.getByText(/Save frames/)).toBeVisible()
  await expect(page.getByRole('link', { name: /Tonight/ }).last()).toHaveAttribute('href', '/rigs/fra400/observe/capture')
  await expect(page).toHaveURL(/\/saved-images$/)
  await expect(preview(page).getByRole('img')).toHaveCount(0)
  await expect(originalDownload(page)).toHaveCount(0)
  expect(scene.detailReads).toEqual([])
  expect(scene.fileReads).toEqual([])
})


test('switching rigs opens the new collection without carrying a foreign selected image or native state', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { scene, requests } = await openPhotographsScene(page, 'photographs-rig-switch')
  const selected = scene.images()[0]!
  await expectSelected(page, selected)
  await preview(page).getByRole('button', { name: '100%', exact: true }).click()
  const native = preview(page).getByRole('region', { name: /Image at 100 percent/ })
  await expect(native).toBeVisible()
  const before = await viewportPosition(native)
  await native.focus()
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await viewportPosition(native)).left).toBe(before.left + 80)
  const selector = page.getByRole('combobox', { name: /Viewing rig/ })
  await selector.selectOption('seestar')
  await expect(page).toHaveURL(/\/rigs\/seestar\/observe\/saved-images$/)
  await expect(page.getByText(/Save frames/)).toBeVisible()
  await expect(preview(page).getByRole('img')).toHaveCount(0)
  await expect(page.getByRole('region', { name: /Image at 100 percent/ })).toHaveCount(0)
  await expect(originalDownload(page)).toHaveCount(0)
  expect(requests.some(request => request.includes('/api/web/rigs/seestar/saved-images/'))).toBe(false)
  expect(scene.unknownRequests).toEqual([])
  await selector.selectOption('fra400')
  await expectSelected(page, selected)
  await expect(preview(page).getByRole('button', { name: 'Fit', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(preview(page).getByRole('button', { name: '100%', exact: true })).toHaveAttribute('aria-pressed', 'false')
})

test('enlarging a saved photograph preserves native pixels and restores selected pan and focus on return', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { scene } = await openPhotographsScene(page, 'photographs-light')
  await expectSelected(page, scene.images()[0]!)
  await preview(page).getByRole('button', { name: '100%', exact: true }).click()
  const native = preview(page).getByRole('region', { name: /Image at 100 percent/ })
  await expect(native).toBeVisible()
  const before = await viewportPosition(native)
  await native.focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowDown')
  await expect.poll(async () => (await viewportPosition(native)).left).toBe(before.left + 80)
  await expect.poll(async () => (await viewportPosition(native)).top).toBe(before.top + 80)
  const position = await viewportPosition(native)
  const pixels = await native.getByRole('img').getAttribute('src')
  const detailReads = [...scene.detailReads]
  const selectedUrl = page.url()
  const opener = preview(page).getByRole('button', { name: 'Enlarge image', exact: true })
  await opener.click()
  const dialog = page.getByRole('dialog').filter({ has: page.getByRole('img') })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('img')).toHaveAttribute('src', pixels!)
  await expect(dialog.getByRole('button', { name: '100%', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(opener).toBeFocused()
  await expect(native.getByRole('img')).toHaveAttribute('src', pixels!)
  expect(await viewportPosition(native)).toEqual(position)
  expect(page.url()).toBe(selectedUrl)
  expect(scene.detailReads).toEqual(detailReads)
})
