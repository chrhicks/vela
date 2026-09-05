/** Opt-in end-to-end proof. Never imports simulator geometry or supplies truth to the solver. */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createAlpacaAcquisition, createAlpacaProvider } from '../../../packages/alpaca/dist/index.js'
import { createAlignmentBaseline, measureAlignment, type AlignmentSample, type AlignmentMeasurement } from '../../server/dist/alignment/geometry.js'
import { createAstapSolver } from '../../server/dist/alignment/solver.js'
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

async function control(path: string, body: unknown, method = 'PUT') {
  const response = await fetch(`${baseUrl}/simulator/${path}`, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`Simulator control failed: ${text}`)
}

async function exposure() {
  // These hints and observer coordinates come only from standard Alpaca reads.
  const pointing = await hardware.pointing(telescopeId, signal)
  const pointingObservedAt = Date.now()
  assert.equal(pointing.coordinateSystem, 'other')
  assert.equal(pointing.tracking, true)
  const frame = await hardware.capture({ cameraId, exposureSeconds: 0.1, signal })
  const solved = await solver.solve(frame, {
    raDegrees: pointing.rightAscensionDegrees, decDegrees: pointing.declinationDegrees,
  }, signal)
  return { pointing, frame, solved, pointingObservedAt }
}

async function sample(): Promise<{ sample: AlignmentSample, latitude: number }> {
  const { pointing, frame, solved, pointingObservedAt } = await exposure()
  assert.equal(solved.status, 'solved', 'Clear synthetic exposure must actually solve')
  if (solved.status !== 'solved') throw new Error('Unreachable no-solution')
  return {
    sample: { raDegrees: solved.raDegrees, decDegrees: solved.decDegrees,
      capturedAt: frame.capturedAt, siderealTimeDegrees: (pointing.siderealTimeDegrees
        + (Date.parse(frame.capturedAt) - pointingObservedAt) / 1000 * 360 / 86164.0905 + 360) % 360 },
    latitude: pointing.latitudeDegrees,
  }
}

function check(name: string, measurement: AlignmentMeasurement, altitudeArcsec: number, azimuthArcsec: number) {
  assert.ok(Math.abs(measurement.altitudeArcsec - altitudeArcsec) < toleranceArcsec,
    `${name}: altitude ${measurement.altitudeArcsec} exceeds ${toleranceArcsec} arcsec tolerance from ${altitudeArcsec}`)
  assert.ok(Math.abs(measurement.azimuthArcsec - azimuthArcsec) < toleranceArcsec,
    `${name}: azimuth ${measurement.azimuthArcsec} exceeds ${toleranceArcsec} arcsec tolerance from ${azimuthArcsec}`)
  const report = { name, expected: { altitudeArcsec, azimuthArcsec }, measured: measurement }
  reports.push(report)
  console.log(JSON.stringify(report))
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
    const state = await response.json() as { cameraActivity: string }
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
  const idle = await fetch(`${baseUrl}/simulator/state`).then(response => response.json()) as { cameraActivity: string, raRateDegreesPerSecond: number }
  assert.equal(idle.cameraActivity, 'idle')
  assert.equal(idle.raRateDegreesPerSecond, 0)
  await writeFile(join(output, 'results.json'), JSON.stringify({ toleranceArcsec, reports,
    obscured: 'real ASTAP no-solution', cancellation: 'exposure aborted and fresh restart solved' }, null, 2))
  console.log(`HTTP proof passed: ${join(output, 'results.json')}`)
} finally {
  try { await hardware.abort(cameraId, telescopeId) } finally { await app.close() }
}
