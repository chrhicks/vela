/** Opt-in proof: production framing routes, real Alpaca HTTP and actual ASTAP.
 * Only the rig catalog is isolated. No simulated truth enters Vela's solver.
 */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import Fastify from 'fastify'
import type { FramingView } from '../../../packages/model/dist/web/index.js'
import { createAlpacaFraming, createAlpacaProvider } from '../../../packages/alpaca/dist/index.js'
import { createMemoryRigCatalog } from '../../server/dist/rig/catalog.js'
import { createRigOperations } from '../../server/dist/rig/operations.js'
import { registerTargets } from '../../server/dist/targets/routes.js'
import { getTarget } from '../../server/dist/targets/catalog/index.js'
import { createStarSource } from './catalog.js'
import { focalLengthMm } from './optics.js'
import { buildSimulator } from './service.js'

const catalogPath = process.env.VELA_STAR_CATALOG

const executable = process.env.VELA_ASTAP

if (!catalogPath || !executable)
  throw new Error('Set VELA_STAR_CATALOG and VELA_ASTAP; see README.md')

const output = resolve(process.env.VELA_SIM_OUTPUT ?? '.local/framing-proof')

await mkdir(output, { recursive: true })

let clockOffset = 0

const simulator = buildSimulator({
  stars: createStarSource(catalogPath),
  now: () => performance.now() + clockOffset,
})

const vela = Fastify()

const reports: object[] = []

try {
  const baseUrl = await simulator.listen({ host: '127.0.0.1', port: 0 })
  const provider = createAlpacaProvider({ baseUrl })
  const mount = createAlpacaFraming({ baseUrl })
  const cameraId = 'vela-simulator-camera'
  const telescopeId = 'vela-simulator-telescope'

  for (const id of [cameraId, telescopeId]) {
    assert.equal((await provider.connectDevice(id)).outcome, 'connected')
  }

  const devices = await provider.inspectDevices()

  const catalog = createMemoryRigCatalog([
    {
      id: 'proof',
      name: 'Framing proof',
      endpoint: { host: '127.0.0.1', port: Number(new URL(baseUrl).port) },
      imagingCamera: { uniqueId: cameraId, name: 'Simulator Camera' },
      focalLengthMm,
      addedAt: new Date().toISOString(),
      lastObservedInventory: {
        observedAt: new Date().toISOString(),
        devices: devices.map(device => ({
          uniqueId: device.providerDeviceId,
          kind: device.kind,
          name: device.configuredName,
        })),
      },
    },
  ])

  const operations = createRigOperations()
  registerTargets(vela, catalog, operations, { solver: { executable, catalogPath } })
  const eagle = getTarget('ic4703')!
  assert.ok(eagle)

  async function view() {
    const response = await vela.inject('/api/web/rigs/proof/framing')
    assert.equal(response.statusCode, 200, response.body)

    return response.json<FramingView>()
  }

  async function command(
    command: string,
    payload: {
      targetId?: string
      raDegrees?: number
      decDegrees?: number
      exposureSeconds?: number
      checkId?: string
    } = {},
  ) {
    const response = await vela.inject({
      method: 'POST',
      url: `/api/rigs/proof/framing/${command}`,
      payload,
    })

    assert.equal(response.statusCode, 200, response.body)

    return response.json<FramingView>()
  }

  async function control(
    path: string,
    payload: {
      preset?: string
      obscured?: boolean
      cameraNumber?: number
      resolution?: string
    },
    method: 'PUT' | 'POST' = 'PUT',
  ) {
    const response = await simulator.inject({ method, url: `/simulator/${path}`, payload })
    assert.equal(response.statusCode, 200, response.body)
  }

  async function waitFor(predicate: (state: FramingView) => boolean) {
    const deadline = Date.now() + 60_000

    while (Date.now() < deadline) {
      const state = await view()

      if (predicate(state)) return state

      if (!state.active)
        throw new Error(`Framing ended unexpectedly: ${state.phase}: ${state.error}`)
      await delay(50)
    }

    throw new Error('Framing proof timed out')
  }

  const start = (
    exposureSeconds = 2,
    position = { raDegrees: eagle.raDegrees, decDegrees: eagle.decDegrees },
  ) =>
    command('start', {
      targetId: eagle.id,
      raDegrees: position.raDegrees,
      decDegrees: position.decDegrees,
      exposureSeconds,
    })

  const finish = () => waitFor(state => !state.active)

  function checked(state: FramingView) {
    assert.equal(state.phase, 'checked', state.error ?? 'Expected a solved check')
    assert.equal(state.checkCurrent, true)
    assert.ok(state.actual)
    assert.equal(operations.owner('proof'), undefined)

    return state.actual
  }

  assert.equal((await view()).enabled, true)
  const defaultGeometry = (await view()).camera!
  assert.equal(defaultGeometry.width, 6248)
  assert.equal(defaultGeometry.height, 4176)
  assert.ok(Math.abs(defaultGeometry.fieldHeightDegrees - 3) < 1e-10)
  await start()
  const firstState = await finish()
  const first = checked(firstState)
  assert.equal(
    firstState.canCenter,
    true,
    'The original polar error must produce a measurable miss',
  )
  const nominal = await mount.telescopeStatus(telescopeId)
  assert.ok(Math.abs(nominal.rightAscensionDegrees - eagle.raDegrees) < 1e-6)
  assert.ok(Math.abs(nominal.declinationDegrees - eagle.decDegrees) < 1e-6)
  await command('center', { checkId: first.checkId })
  const centered = checked(await finish())
  assert.ok(
    centered.offsetArcminutes < 0.5 && centered.offsetArcminutes < first.offsetArcminutes / 5,
    `Center must reduce the measured error: ${first.offsetArcminutes} → ${centered.offsetArcminutes}`,
  )
  reports.push({
    scenario: 'eagle-check-and-center',
    firstOffsetArcminutes: first.offsetArcminutes,
    centeredOffsetArcminutes: centered.offsetArcminutes,
  })

  await control('reset', { preset: 'large-error' }, 'POST')
  await start()
  await waitFor(state => state.phase === 'slewing' && state.active)
  // Observe actual device movement before testing Stop.
  const movementDeadline = Date.now() + 5000

  while (!(await mount.telescopeStatus(telescopeId)).slewing) {
    assert.ok(Date.now() < movementDeadline, 'Slew did not begin')
    await delay(10)
  }

  const stopped = await command('stop')
  assert.equal(stopped.phase, 'stopped', stopped.error ?? '')
  assert.equal(stopped.active, false)
  assert.equal((await mount.telescopeStatus(telescopeId)).slewing, false)
  assert.equal(operations.owner('proof'), undefined)

  await start(20)
  await waitFor(state => state.phase === 'exposing')
  const exposureDeadline = Date.now() + 5000

  while ((await simulator.inject('/simulator/state')).json().cameras[0].activity !== 'exposing') {
    assert.ok(Date.now() < exposureDeadline, 'Exposure did not begin')
    await delay(10)
  }

  assert.equal((await command('stop')).phase, 'stopped')
  assert.equal((await simulator.inject('/simulator/state')).json().cameras[0].imageReady, false)
  await start()
  checked(await finish())
  reports.push({ scenario: 'stop-during-slew-and-exposure', cleanRestart: true })

  await control('camera', { obscured: true })
  await start()
  const obscured = await finish()
  assert.equal(obscured.phase, 'failed')
  assert.match(obscured.error ?? '', /could not be plate solved/)
  await control('camera', { obscured: false })
  await start()
  checked(await finish())
  reports.push({ scenario: 'obscured-solve-failure-and-recovery', recovered: true })

  await control('camera', { cameraNumber: 0, resolution: 'full' })
  const fullGeometry = (await view()).camera!
  assert.equal(fullGeometry.width, 6248)
  assert.equal(fullGeometry.height, 4176)
  assert.equal(fullGeometry.fieldHeightDegrees, defaultGeometry.fieldHeightDegrees)
  assert.equal(fullGeometry.fieldWidthDegrees, defaultGeometry.fieldWidthDegrees)
  await start()
  const full = checked(await finish())
  assert.ok(Math.abs(full.offsetArcminutes - first.offsetArcminutes) < 0.1)
  reports.push({
    scenario: 'full-resolution-same-field',
    offsetArcminutes: full.offsetArcminutes,
    fieldWidthDegrees: fullGeometry.fieldWidthDegrees,
    fieldHeightDegrees: fullGeometry.fieldHeightDegrees,
  })

  const colorId = 'vela-simulator-color-camera'
  assert.equal((await provider.connectDevice(colorId)).outcome, 'connected')
  await catalog.setImagingCamera('proof', { uniqueId: colorId, name: 'Simulator Color Camera' })
  await start()
  const colorFirst = checked(await finish())
  await command('center', { checkId: colorFirst.checkId })
  const colorCentered = checked(await finish())
  assert.ok(colorCentered.offsetArcminutes < 0.5)
  reports.push({
    scenario: 'color-check-and-center',
    firstOffsetArcminutes: colorFirst.offsetArcminutes,
    centeredOffsetArcminutes: colorCentered.offsetArcminutes,
  })

  // Browser regression: the crowded Crescent field failed at five seconds
  // in the old low-resolution renderer despite abundant image stars.
  const crescent = { raDegrees: 303.02729167, decDegrees: 38.34497497555 }

  for (const seconds of [2, 5]) {
    await start(seconds, crescent)
    const before = checked(await finish())
    await command('center', { checkId: before.checkId })
    const after = checked(await finish())
    assert.ok(after.offsetArcminutes < 0.5)
    reports.push({
      scenario: 'crescent-color-check-and-center',
      exposureSeconds: seconds,
      firstOffsetArcminutes: before.offsetArcminutes,
      centeredOffsetArcminutes: after.offsetArcminutes,
    })
  }

  // An established browser session samples a different polar-error orientation
  // and pixel phase than a freshly reset rig. Exercise that centered field too.
  clockOffset += 25 * 60 * 1000
  await start(5, { raDegrees: 303.02729167, decDegrees: 38.35494444 })
  const aged = checked(await finish())
  await command('center', { checkId: aged.checkId })
  const agedCentered = checked(await finish())
  assert.ok(agedCentered.offsetArcminutes < 0.5)
  reports.push({
    scenario: 'crescent-after-25-minutes',
    centeredOffsetArcminutes: agedCentered.offsetArcminutes,
  })

  await catalog.setImagingCamera('proof', { uniqueId: cameraId, name: 'Simulator Camera' })
  await control('camera', { cameraNumber: 0, resolution: 'full' })

  for (const position of [
    { raDegrees: 359.9, decDegrees: 0 },
    { raDegrees: 45, decDegrees: 89 },
  ]) {
    await start(2, position)
    const result = checked(await finish())
    reports.push({
      scenario: 'all-sky-field',
      desired: position,
      offsetArcminutes: result.offsetArcminutes,
    })
  }

  await writeFile(join(output, 'results.json'), JSON.stringify(reports, null, 2) + '\n')
  console.log(JSON.stringify(reports, null, 2))
} finally {
  await vela.close()
  await simulator.close()
}
