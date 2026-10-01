// Reproduction recipe: copy this file to apps/web/tests/legacy-archive.e2e.ts.
// Run from the pre-Fieldroom commit; see README.md. This is not an active suite.
import { expect, test } from '@playwright/test'
import { VELA_CURRENT_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(process.cwd(), '../..')
const archive = resolve(root, 'docs/visual-reference/vela-current')
const timestamp = '2026-09-21T01:00:08.000Z'
const capturedAt = '2026-09-21T01:00:00.000Z'
const sourceSha = '15c2bbe19770ef55ed2d6aa830fb833a19216ae4'
const hash = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex')
const imageSource = 'packages/ui/src/components/fixtures/capture-star-field.png'
const imageUrl = '/api/rigs/rig-1/capture/images/retained'
const rig = {
  id: 'rig-1', name: 'Askar FRA 400', state: 'reachable',
  endpoint: { host: 'alpaca.local', port: 11111 },
  addedAt: capturedAt, lastInventoryAt: capturedAt, refreshedAt: timestamp,
  connections: { total: 3, connected: 3, disconnected: 0, unavailable: 0 },
  capabilities: ['forget'],
  devices: [
    { id: 'camera-0', kind: 'camera', name: 'ZWO ASI2600MC Pro', configuredName: 'Main camera', connection: 'connected', observedAt: timestamp,
      status: { availability: 'complete', activity: 'idle', sensorTemperatureC: -10, cooling: { state: 'on', powerPercent: 42 } } },
    { id: 'focuser-0', kind: 'focuser', name: 'ZWO Focuser', configuredName: 'Focuser', connection: 'connected', observedAt: timestamp,
      status: { availability: 'complete', activity: 'idle', position: 32842, temperatureC: 17 } },
    { id: 'mount-0', kind: 'telescope', name: 'ASI Mount', configuredName: 'Mount', connection: 'connected', observedAt: timestamp,
      status: { availability: 'complete', activity: 'tracking', tracking: 'on', parking: 'unparked', home: 'away' } },
  ],
}
const capture = {
  rigId: 'rig-1', rigName: rig.name, camera: { name: 'ZWO ASI2600MC Pro' },
  enabled: true, unavailableReason: null, phase: 'exposing', active: true,
  captureReadState: 'current', exposureSeconds: 180, elapsedSeconds: 96,
  repeat: true, completedCount: 12, saveFrames: true, savedImageCount: 12, error: null,
  cooling: { state: 'on', canSetTemperature: true, setpointC: -10, sensorTemperatureC: -10, powerPercent: 42 },
  latestImage: { id: 'retained', saved: true, imageUrl, width: 1600, height: 1200,
    exposureSeconds: 180, capturedAt, receivedAt: '2026-09-21T01:00:03.000Z',
    cameraName: 'ZWO ASI2600MC Pro', color: 'mono', statistics: { detectedStars: 842, medianHfrPixels: 2.1 } },
}
const fixtures: Record<string, unknown> = {
  '/api/web/navigation': { rigs: [{ id: 'rig-1', name: rig.name }], captures: [{ rigId: 'rig-1', rigName: rig.name,
    phase: 'exposing', active: true, captureReadState: 'current', completedCount: 12, elapsedSeconds: 96, exposureSeconds: 180, error: null }] },
  '/api/web/rigs/rig-1': rig,
  '/api/web/rigs/rig-1/observe': { rig, connectionPreparation: { state: 'complete', capabilities: [] } },
  '/api/web/rigs/rig-1/capture': capture,
  '/api/web/rigs/rig-1/imaging-camera': { rigId: 'rig-1', editable: true, state: 'ready',
    selected: { id: 'camera-0', name: 'ZWO ASI2600MC Pro' },
    cameras: [{ id: 'camera-0', configuredName: 'Main camera', name: 'ZWO ASI2600MC Pro' }] },
  '/api/web/rigs/rig-1/alignment': {
    rigId: 'rig-1', rigName: rig.name, mode: 'physical', enabled: true, unavailableReason: null,
    phase: 'adjusting', activity: 'waiting', active: true, position: 3, solvedPositions: 3,
    exposureSeconds: 2, exposureStartedAt: null, measuredAt: capturedAt, warning: null, error: null,
    measurement: { imageUrl, imageWidth: 1600, imageHeight: 1200, fieldHeightDegrees: 2,
      capturedAtSource: 'server-estimate', totalArcsec: 503, azimuthArcsec: -440, altitudeArcsec: -244,
      targetX: 726.1667, targetY: 558.8333 },
  },
}
const scenes = [
  { id: 'capture-desktop', route: '/rigs/rig-1/observe/capture', width: 1440, height: 900, ready: '.capture-page__controls' },
  { id: 'equipment-desktop', route: '/rigs/rig-1', width: 1440, height: 900, ready: '.vela-rig-device' },
  { id: 'observe-desktop', route: '/rigs/rig-1/observe', width: 1440, height: 900, ready: '.vela-capture-hub' },
  { id: 'alignment-phone', route: '/rigs/rig-1/observe/alignment', width: 390, height: 844, ready: '.vela-polar-image' },
]

test('freeze the legacy Vela Current production-route appearance', async ({ page, browser }) => {
  expect(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()).toBe(sourceSha)
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--', 'apps/web/src', 'packages/ui/src'], { cwd: root })
  mkdirSync(resolve(archive, 'assets'), { recursive: true })
  copyFileSync(resolve(root, imageSource), resolve(archive, 'assets/capture-star-field.png'))
  writeFileSync(resolve(archive, 'fixtures.json'), JSON.stringify(fixtures, null, 2) + '\n')
  const theme = resolveTheme(VELA_CURRENT_PROFILE)
  const tokenStyle = themeStyle(theme, 'dark')
  writeFileSync(resolve(archive, 'theme.json'), JSON.stringify({ profile: VELA_CURRENT_PROFILE, resolved: theme,
    mode: 'dark', density: 1, cssTokens: tokenStyle, lightCssTokens: themeStyle(theme, 'light') }, null, 2) + '\n')
  const sourceFiles = ['packages/ui/src/styles.css', 'packages/ui/src/themes/defaults.ts', 'packages/ui/src/themes/runtime.ts',
    'packages/ui/src/fonts/InterVariable.woff2', 'packages/ui/src/fonts/InterVariable-Italic.woff2',
    'apps/web/src/styles.css', 'apps/web/src/main.tsx']
  const sourceHashes = Object.fromEntries(sourceFiles.map(path => [path, hash(resolve(root, path))]))
  const writes: string[] = [], unmapped = new Set<string>(), errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.clock.setFixedTime(new Date(timestamp))
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname
    if (route.request().method() !== 'GET') {
      writes.push(path)
      return route.fulfill({ status: 405, json: { error: 'Read-only archive fixture' } })
    }
    if (path === imageUrl) return route.fulfill({ contentType: 'image/png', path: resolve(archive, 'assets/capture-star-field.png') })
    if (fixtures[path]) return route.fulfill({ json: fixtures[path] })
    unmapped.add(path)
    return route.fulfill({ status: 503, json: { error: 'No archive fixture for this request' } })
  })
  const results = []
  for (const scene of scenes) {
    await page.setViewportSize({ width: scene.width, height: scene.height })
    await page.goto(scene.route)
    await expect(page.locator(scene.ready).first()).toBeVisible()
    await page.evaluate(async () => {
      await document.fonts.ready
      await Promise.all([...document.images].map(image => image.decode().catch(() => undefined)))
    })
    await expect(page.locator('.vela-theme')).toBeVisible()
    const tokens = await page.locator('.vela-theme').evaluate((element, names) => {
      const style = getComputedStyle(element)
      return Object.fromEntries(names.map(name => [name, style.getPropertyValue(name).trim()]))
    }, Object.keys(tokenStyle))
    expect(tokens).toEqual(tokenStyle)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(archive, `${scene.id}.png`), fullPage: true, animations: 'disabled' })
    results.push({ ...scene, png: `${scene.id}.png`, sha256: hash(resolve(archive, `${scene.id}.png`)),
      pageSize: await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight })) })
  }
  expect(writes).toEqual([])
  expect([...unmapped]).toEqual([])
  expect(errors).toEqual([])
  expect(Object.fromEntries(sourceFiles.map(path => [path, hash(resolve(root, path))]))).toEqual(sourceHashes)
  writeFileSync(resolve(archive, 'manifest.json'), JSON.stringify({ schemaVersion: 1, sourceSha,
    capturedAt: new Date().toISOString(), fixedBrowserTime: timestamp, browser: browser.version(),
    platform: process.platform, locale: 'en-US', timezone: 'America/New_York', deviceScaleFactor: 1,
    themeMode: 'dark', sourceHashes, image: { source: imageSource, archive: 'assets/capture-star-field.png', sha256: hash(resolve(root, imageSource)) },
    fixtureSources: ['apps/web/tests/fixtures/observation.ts', 'apps/web/tests/rig-detail.e2e.ts', 'apps/web/tests/alignment-inspection.e2e.ts', 'apps/web/tests/exposure-recovery.e2e.ts'],
    fixtureSha256: hash(resolve(archive, 'fixtures.json')), scenes: results, apiWrites: writes, unmappedRequests: [...unmapped], browserErrors: errors,
    limitation: 'Static synthetic fixture scenes; not physical-device observations. Current production theme is dark only. Light token mapping is retained in theme.json but no light application rendering was synthesized.' }, null, 2) + '\n')
})

test.use({ locale: 'en-US', timezoneId: 'America/New_York', deviceScaleFactor: 1 })
