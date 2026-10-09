import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { CriaClient, CriaStateSchema } from '@vela/cria'
import { CaptureStoppedError } from '@vela/equipment'
import type { CaptureView, RigDetailView } from '@vela/model/web'
import { createCriaEquipment } from '../src/cria/equipment.js'
import { createEquipmentComposition } from '../src/equipment/composition.js'
import { parseCriaConfiguration, registerConfiguredCriaRigs } from '../src/equipment/config.js'
import { createMemoryRigCatalog } from '../src/rig/catalog.js'
import { createMemorySavedImageStore } from '../src/saved-images/store.js'
import { buildApp } from '../src/app.js'

// Explicit opt-in fixture check. It never discovers or connects to physical equipment.
const path = process.argv[2]

if (!path) throw new Error('Pass the private connection.json from Cria serve_fixture.py')

const connection = z.object({
  fixtureOnly: z.literal(true),
  imageMode: z.literal('ramp'),
  baseUrl: z.url().refine(value => new URL(value).hostname === '127.0.0.1'),
  token: z.string().min(32),
  devices: z.array(z.object({
    id: z.enum(['camera', 'mount', 'focuser', 'weather', 'switch']),
    kind: z.enum(['camera', 'mount', 'focuser', 'weather', 'switch']),
    expectedName: z.string().startsWith('FIXTURE '),
  })),
}).parse(JSON.parse(await readFile(path, 'utf8')))

const response = await fetch(`${connection.baseUrl}/v2/state`, {
  headers: { authorization: `Bearer ${connection.token}` },
})

assert.equal(response.status, 200)

const state = CriaStateSchema.parse(await response.json())

const client = new CriaClient({
  baseUrl: connection.baseUrl,
  token: connection.token,
  storeId: state.storeId,
  devices: connection.devices,
})

const bindings = connection.devices.map(device => ({ ...device, providerDeviceId: `fixture:${device.id}` }))

const equipment = createCriaEquipment(client, bindings)

assert.equal((await equipment.provider.inspectDevices()).length, 5)

const geometry = await equipment.framing.cameraGeometry({ cameraId: 'fixture:camera' })

const frame = await equipment.acquisition.capture({ cameraId: 'fixture:camera', exposureSeconds: 0.1 })

assert.equal(frame.width, geometry.width)

assert.equal(frame.height, geometry.height)

assert.equal(frame.pixels[1]! - frame.pixels[0]!, 1)

assert.equal(frame.pixels[frame.width]! - frame.pixels[0]!, frame.width)

console.log('PASS verified original pixels, geometry and ownership transfer')

const initialCooling = await equipment.cooling.observe('fixture:camera')

assert.ok(initialCooling)

try {
  const cooling = await equipment.cooling.setCooling({ cameraId: 'fixture:camera', coolerOn: true, setpointC: -12 })
  assert.equal(cooling.outcome, 'confirmed')

  if (cooling.outcome === 'confirmed') {
    assert.equal(cooling.observation.state, 'on')
    assert.equal(cooling.observation.setpointC, -12)
  }
} finally {
  await equipment.cooling.setCooling({
    cameraId: 'fixture:camera', coolerOn: initialCooling.state === 'on',
    setpointC: initialCooling.setpointC ?? 0,
  })
}

console.log('PASS cooling write and fresh confirmation')

const focus = await equipment.focuser.status('fixture:focuser')

const target = focus.position + 100

const window = { minPosition: 1, maxPosition: focus.maxStep - 1 }

assert.ok(target < window.maxPosition)

try {
  assert.equal((await equipment.focuser.move({ focuserId: 'fixture:focuser', position: target, window })).position, target)
} finally {
  await equipment.focuser.move({ focuserId: 'fixture:focuser', position: focus.position, window })
}

console.log('PASS focuser travel and restored position')

const mount = await equipment.framing.telescopeStatus('fixture:mount')

try {
  await equipment.framing.slew({
    telescopeId: 'fixture:mount', rightAscensionDegrees: 100, declinationDegrees: 20,
    coordinateSystem: mount.coordinateSystem,
  })
  const pointing = await equipment.acquisition.pointing('fixture:mount')
  assert.ok(Math.abs(pointing.rightAscensionDegrees - 100) < 0.01)
  assert.equal(pointing.declinationDegrees, 20)
  await equipment.acquisition.move('fixture:mount', 1, 0.1)
  await equipment.acquisition.rotateRightAscension('fixture:mount', 2, 0.3)
  assert.equal((await equipment.framing.telescopeStatus('fixture:mount')).slewing, false)
} finally {
  await equipment.framing.slew({
    telescopeId: 'fixture:mount', rightAscensionDegrees: mount.rightAscensionDegrees,
    declinationDegrees: mount.declinationDegrees, coordinateSystem: mount.coordinateSystem,
  })
}

console.log('PASS framing coordinates, RA hour conversion and alignment axis operations')

const cancellation = new AbortController()

await assert.rejects(equipment.acquisition.capture({
  cameraId: 'fixture:camera', exposureSeconds: 3, signal: cancellation.signal,
  onProgress(elapsed) {
    if (elapsed > 0.1) cancellation.abort()
  },
}), CaptureStoppedError)

console.log('PASS exposure cancellation waits for confirmed equipment cleanup')

await client.close()

const configurations = parseCriaConfiguration(JSON.stringify({ rigs: [{
  id: 'fixture-check', name: 'Cria fixture check', url: connection.baseUrl,
  tokenEnv: 'FIXTURE_TOKEN', storeId: state.storeId, devices: connection.devices,
  imagingCameraId: 'camera', focalLengthMm: 400,
}] }), { FIXTURE_TOKEN: connection.token })

const catalog = createMemoryRigCatalog()

await registerConfiguredCriaRigs(catalog, configurations)

const savedImages = createMemorySavedImageStore()

const app = buildApp({
  rigCatalog: catalog, savedImages,
  equipment: createEquipmentComposition(configurations),
})

try {
  const detailResponse = await app.inject('/api/web/rigs/fixture-check')
  assert.equal(detailResponse.statusCode, 200)
  const detail = detailResponse.json<RigDetailView>()
  assert.equal(detail.devices.length, 5)
  assert.ok(detail.devices.every(device => device.observation?.state !== 'interrupted'))

  const start = await app.inject({ method: 'POST', url: '/api/rigs/fixture-check/capture/start',
    payload: { exposureSeconds: 0.1, repeat: false, saveFrames: true } })

  assert.equal(start.statusCode, 200, start.body)

  let capture: CaptureView | undefined
  const deadline = Date.now() + 30000

  do {
    await delay(100)
    capture = (await app.inject('/api/web/rigs/fixture-check/capture')).json<CaptureView>()
  } while (capture.active && Date.now() < deadline)

  assert.equal(capture.phase, 'complete', capture.error ?? undefined)
  assert.equal(capture.completedCount, 1)
  assert.equal(capture.savedCount, 1)
  assert.ok(capture.latestImage)
  const image = await savedImages.get('fixture-check', capture.latestImage.id)
  assert.ok(image)
  const original = await savedImages.file('fixture-check', capture.latestImage.id, 'fits')
  assert.ok(original)
  assert.equal(original.subarray(0, 8).toString('ascii'), 'SIMPLE  ')
  console.log('PASS actual Vela routes → capture controller → preview, FITS and saved-image ownership')
} finally {
  await app.close()
}

console.log('Cria fixture integration checks passed; this does not qualify physical hardware or plate solving.')
