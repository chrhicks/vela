import { z } from 'zod'
/** Opt-in end-to-end proof. Never imports simulator geometry or supplies truth to the solver. */
import assert from 'node:assert/strict'
import Fastify from 'fastify'
import { inflateSync } from 'node:zlib'
import type { CaptureView, ImagingCameraView } from '../../../packages/model/dist/web/index.js'
import { createMemoryRigCatalog } from '../../server/dist/rig/catalog.js'
import { createRigOperations } from '../../server/dist/rig/operations.js'
import { registerImagingCamera } from '../../server/dist/rig/imaging-camera.js'
import { registerCapture } from '../../server/dist/capture/routes.js'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createAlpacaAcquisition, createAlpacaProvider } from '../../../packages/alpaca/dist/index.js'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample, type AlignmentMeasurement } from '../../server/dist/alignment/geometry.js'
import { createAstapSolver } from '../../server/dist/alignment/solver.js'
import { imageWidth, imageHeight } from './optics.js'
import { loadCatalog } from './catalog.js'
import { buildSimulator } from './service.js'

const catalogPath = process.env.VELA_STAR_CATALOG

const executable = process.env.VELA_ASTAP

if (!catalogPath || !executable) throw new Error('Set VELA_STAR_CATALOG and VELA_ASTAP; see README.md')

const output = resolve(process.env.VELA_SIM_OUTPUT ?? '.local/http-proof')

await mkdir(output, { recursive: true })

const app = buildSimulator({ stars: await loadCatalog(catalogPath) })

const baseUrl = await app.listen({ host: '127.0.0.1', port: 0 })

const cameraId = 'vela-simulator-camera'

const telescopeId = 'vela-simulator-telescope'

const hardware = createAlpacaAcquisition({ baseUrl })

const provider = createAlpacaProvider({ baseUrl })

const solver = createAstapSolver({ executable, catalogPath, fieldHeightDegrees: 3 })

const signal = new AbortController().signal

const reports: object[] = []

const toleranceArcsec = 10

async function control(
  path: string,
  body: {
    altitudeArcsec?: number
    azimuthArcsec?: number
    preset?: string
    obscured?: boolean
    cameraNumber?: number
    resolution?: string
  },
  method: 'PUT' | 'POST' = 'PUT',
) {
  const response = await fetch(`${baseUrl}/simulator/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

  const text = await response.text()

  if (!response.ok) throw new Error(`Simulator control failed: ${text}`)
}

async function exposure() {
  // These hints and observer coordinates come only from standard Alpaca reads.
  const pointing = await hardware.pointing(telescopeId, signal)
  const pointingObservedAt = Date.now()
  assert.equal(pointing.coordinateSystem, 'j2000')
  assert.equal(pointing.tracking, true)
  const frame = await hardware.capture({ cameraId, exposureSeconds: 2, signal })

  const solved = await solver.solve(frame, {
    raDegrees: pointing.rightAscensionDegrees,
    decDegrees: pointing.declinationDegrees,
  }, signal)

  return { pointing, frame, solved, pointingObservedAt }
}

async function sample(): Promise<{ sample: AlignmentSample, latitude: number }> {
  const { pointing, frame, solved, pointingObservedAt } = await exposure()
  assert.equal(solved.status, 'solved', 'Clear synthetic exposure must actually solve')

  if (solved.status !== 'solved') throw new Error('Unreachable no-solution')

  return {
    sample: {
      raDegrees: solved.raDegrees,
      decDegrees: solved.decDegrees,
      capturedAt: frame.capturedAt,
      siderealTimeDegrees: (pointing.siderealTimeDegrees
        + (Date.parse(frame.capturedAt) - pointingObservedAt) / 1000 * 360 / 86164.0905 + 360) % 360,
    },
    latitude: pointing.latitudeDegrees,
  }
}

function check(
  name: string,
  measurement: AlignmentMeasurement,
  altitudeArcsec: number,
  azimuthArcsec: number,
) {
  assert.ok(Math.abs(measurement.altitudeArcsec - altitudeArcsec) < toleranceArcsec,
    `${name}: altitude ${measurement.altitudeArcsec} exceeds ${toleranceArcsec} arcsec tolerance from ${altitudeArcsec}`)
  assert.ok(Math.abs(measurement.azimuthArcsec - azimuthArcsec) < toleranceArcsec,
    `${name}: azimuth ${measurement.azimuthArcsec} exceeds ${toleranceArcsec} arcsec tolerance from ${azimuthArcsec}`)
  const report = { name, expected: { altitudeArcsec, azimuthArcsec }, measured: measurement }
  reports.push(report)
  console.log(JSON.stringify(report))
}

// Exercise the production selection and Capture routes with their real Alpaca
// boundaries. Only the catalog is isolated in memory; no saved rigs are touched.
async function proveCapture() {
  const colorId = 'vela-simulator-color-camera'
  assert.equal((await provider.connectDevice(colorId)).outcome, 'connected')
  const devices = await provider.inspectDevices()

  const catalog = createMemoryRigCatalog([{
    id: 'proof',
    name: 'Simulator proof',
    endpoint: { host: '127.0.0.1', port: Number(new URL(baseUrl).port) },
    addedAt: new Date().toISOString(),
    lastObservedInventory: {
      observedAt: new Date().toISOString(),
      devices: devices.map(device => ({
        uniqueId: device.providerDeviceId,
        kind: device.kind,
        name: device.configuredName,
      })),
    },
  }])

  const vela = Fastify()
  const operations = createRigOperations()
  registerImagingCamera(vela, catalog, operations)
  registerCapture(vela, catalog, operations)
  const captureView = async () => (await vela.inject('/api/web/rigs/proof/capture')).json<CaptureView>()

  async function select(id: string) {
    const choices = (await vela.inject('/api/web/rigs/proof/imaging-camera')).json<ImagingCameraView>()
    assert.equal(choices.cameras.length, 2)
    const camera = choices.cameras.find(camera => camera.id === id)
    assert.ok(camera?.name)

    const response = await vela.inject({
      method: 'PUT',
      url: '/api/rigs/proof/imaging-camera',
      payload: { id, name: camera.name },
    })

    assert.equal(response.statusCode, 200, response.body)
    assert.equal((await catalog.get('proof'))?.imagingCamera?.uniqueId, id)
    assert.equal((await vela.inject('/api/web/rigs/proof/imaging-camera')).json<ImagingCameraView>().selected?.id, id)
  }

  async function capture() {
    const response = await vela.inject({
      method: 'POST',
      url: '/api/rigs/proof/capture/start',
      payload: { exposureSeconds: 2 },
    })

    assert.equal(response.statusCode, 200, response.body)
    assert.equal(response.json<CaptureView>().active, true)
    const deadline = Date.now() + 60000

    while (true) {
      const view = await captureView()

      if (!view.active) {
        assert.equal(view.phase, 'complete', view.error ?? 'Capture must complete')
        assert.ok(view.latestImage)

        return view.latestImage
      }

      if (Date.now() > deadline) throw new Error('Capture proof timed out')
      await delay(50)
    }
  }

  async function preview(url: string, width: number, height: number, color: boolean) {
    const response = await vela.inject(url)
    assert.equal(response.statusCode, 200)
    const png = response.rawPayload
    assert.equal(png.subarray(1, 4).toString(), 'PNG')
    assert.equal(png.readUInt32BE(16), width)
    assert.equal(png.readUInt32BE(20), height)
    assert.equal(png[25], color ? 2 : 0)

    if (color) {
      const chunks: Buffer[] = []

      for (let offset = 8; offset < png.length;) {
        const length = png.readUInt32BE(offset)

        if (png.toString('ascii', offset + 4, offset + 8) === 'IDAT') chunks.push(png.subarray(offset + 8, offset + 8 + length))
        offset += length + 12
      }

      const decoded = inflateSync(Buffer.concat(chunks))
      let coloredPixels = 0

      for (let y = 0; y < height; y++) {
        const row = y * (width * 3 + 1)
        assert.equal(decoded[row], 0)

        for (let x = 0; x < width; x++) {
          const offset = row + 1 + x * 3
          const r = decoded[offset]!
          const g = decoded[offset + 1]!
          const b = decoded[offset + 2]!

          if (Math.max(r, g, b) > 100 && Math.max(r, g, b) - Math.min(r, g, b) > 30) coloredPixels++
        }
      }

      assert.ok(coloredPixels > 100, 'Preview must contain visible color, not just an RGB-encoded gray frame')
    }

    return png.length
  }

  try {
    assert.equal((await captureView()).enabled, false, 'No implicit camera selection')

    // Small frames keep the exhaustive JSON/binary transport check bounded.
    // Alignment above and native capture below use the default full frames.
    for (const cameraNumber of [0, 1]) await control('camera', { cameraNumber, resolution: 'fast' })
    await select(colorId)
    const color = await capture()
    assert.equal(color.color, 'color')
    await preview(color.imageUrl, imageWidth, imageHeight, true)

    // Read the same retained sensor frame using both negotiated transports.
    const raw = await fetch(`${baseUrl}/api/v1/camera/1/imagearray`, { headers: { accept: 'application/imagebytes' } })
    assert.match(raw.headers.get('content-type') ?? '', /^application\/imagebytes/)
    const binary = Buffer.from(await raw.arrayBuffer())

    const json = z.object({ ErrorNumber: z.number(), Value: z.array(z.array(z.number())) }).parse(await fetch(`${baseUrl}/api/v1/camera/1/imagearray`, { headers: { accept: 'application/json' } })
      .then(response => response.json()))

    assert.equal(json.ErrorNumber, 0)
    assert.equal(binary.readInt32LE(16), 44)
    assert.equal(binary.readInt32LE(24), 8)
    assert.equal(binary.readInt32LE(32), imageWidth)
    assert.equal(binary.readInt32LE(36), imageHeight)
    assert.equal(binary.length, 44 + imageWidth * imageHeight * 2)

    for (let x = 0; x < imageWidth; x++)
      for (let y = 0; y < imageHeight; y++) {
        assert.equal(binary.readUInt16LE(44 + (x * imageHeight + y) * 2), json.Value[x]![y])
      }

    await select(cameraId)
    const mono = await capture()
    assert.equal(mono.color, 'mono')
    assert.notEqual(mono.id, color.id)
    await preview(mono.imageUrl, imageWidth, imageHeight, false)
    await preview(color.imageUrl, imageWidth, imageHeight, true)

    await control('camera', { cameraNumber: 1, resolution: 'full' })
    await select(colorId)
    const started = performance.now()
    const full = await capture()
    assert.equal(full.color, 'color')
    assert.equal(full.width, 6248)
    assert.equal(full.height, 4176)
    assert.ok(full.fitImageUrl)
    const nativeBytes = await preview(full.imageUrl, 6248, 4176, true)
    const fitBytes = await preview(full.fitImageUrl, 1562, 1044, true)
    assert.ok(fitBytes < nativeBytes)

    const pending = await vela.inject({
      method: 'POST',
      url: '/api/rigs/proof/capture/start',
      payload: { exposureSeconds: 10 },
    })

    assert.equal(pending.statusCode, 200)
    assert.equal((await captureView()).latestImage?.id, full.id)

    const stopped = await vela.inject({
      method: 'POST',
      url: '/api/rigs/proof/capture/stop',
      payload: {},
    })

    assert.equal(stopped.json<CaptureView>().phase, 'stopped', stopped.body)
    assert.equal(stopped.json<CaptureView>().latestImage?.id, full.id)
    reports.push({
      name: 'capture',
      cameraSelection: 'explicit color → mono → color',
      transportParityPixels: imageWidth * imageHeight,
      retainedAfterStop: true,
      full: {
        width: full.width,
        height: full.height,
        nativeBytes,
        fitBytes,
        elapsedMs: performance.now() - started,
      },
    })
  } finally {
    await vela.inject({ method: 'POST', url: '/api/rigs/proof/capture/stop', payload: {} })
    await vela.close()
    await hardware.abort(colorId, telescopeId)
  }
}

try {
  for (const id of [cameraId, telescopeId]) {
    const connected = await provider.connectDevice(id)
    assert.equal(connected.outcome, 'connected')
  }

  await control('reset', { preset: 'large-error' }, 'POST')
  await hardware.move(telescopeId, -1.5, 12, signal)
  const first = await sample()
  await hardware.move(telescopeId, 1.5, 12, signal)
  const second = await sample()
  await hardware.move(telescopeId, 1.5, 12, signal)
  const third = await sample()
  const baseline = createAlignmentBaseline([first.sample, second.sample, third.sample], first.latitude)
  check('baseline-large', baseline.measurement, 480, -360)

  // Keep the same baseline and mount joints through every physical adjustment.
  for (const [name, altitudeArcsec, azimuthArcsec] of [
    ['partial', 240, -180], ['near', 12, -9], ['aligned', 0, 0],
  ] as const) {
    await control('adjust', { altitudeArcsec, azimuthArcsec })
    const next = await sample()
    check(name, measureAlignment(baseline, next.sample, true), altitudeArcsec, azimuthArcsec)
  }

  await control('camera', { obscured: true })
  assert.equal((await exposure()).solved.status, 'no-solution', 'Obscured pixels must fail in ASTAP')
  await control('camera', { obscured: false })
  const recovered = await sample()
  check('clear-recovery', measureAlignment(baseline, recovered.sample, true), 0, 0)

  const cancellation = new AbortController()
  const pending = hardware.capture({ cameraId, exposureSeconds: 10, signal: cancellation.signal })
  const outcome = pending.then(() => 'unexpected image', () => 'cancelled')
  // Observe the pending exposure before issuing cancellation; no timing guess.
  const deadline = Date.now() + 5000

  while (true) {
    const response = await fetch(`${baseUrl}/simulator/state`)
    const state = z.object({ cameraActivity: z.enum(['idle', 'exposing']) }).parse(await response.json())

    if (state.cameraActivity === 'exposing') break

    if (Date.now() > deadline) throw new Error('Exposure never became active')
    await delay(20)
  }

  cancellation.abort()
  assert.equal(await outcome, 'cancelled')
  const restarted = await sample()
  assert.notEqual(restarted.sample.capturedAt, recovered.sample.capturedAt)
  check('restart-freshness', measureAlignment(baseline, restarted.sample, true), 0, 0)
  await hardware.abort(cameraId, telescopeId)

  const idle = z.object({ cameraActivity: z.enum(['idle', 'exposing']), raRateDegreesPerSecond: z.number() }).parse(
    await fetch(`${baseUrl}/simulator/state`).then(response => response.json()),
  )

  assert.equal(idle.cameraActivity, 'idle')
  assert.equal(idle.raRateDegreesPerSecond, 0)
  await proveCapture()
  await writeFile(join(output, 'results.json'), JSON.stringify({
    toleranceArcsec,
    reports,
    obscured: 'real ASTAP no-solution',
    cancellation: 'exposure aborted and fresh restart solved',
  }, null, 2))
  console.log(`HTTP proof passed: ${join(output, 'results.json')}`)
} finally {
  try {
    await hardware.abort(cameraId, telescopeId)
  } finally {
    await app.close()
  }
}
