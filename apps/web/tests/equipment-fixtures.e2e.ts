import { test, expect } from '@playwright/test'
import { isHomeView, isRigDetailView } from '../src/lib/view-validation'
import { isImagingCameraView } from '../src/features/imaging-camera/validation'
import { isFramingView } from '../src/features/targets/validation'
import { isConnectRigDevicesResult, isRigObservationView } from '../src/features/observation/validation'
import { createEquipmentScene, equipmentScenes } from './fixtures/fieldroom/equipment'

test('equipment review snapshots satisfy production projection validators', () => {
  for (const name of equipmentScenes) {
    const scene = createEquipmentScene(name)
    const snapshot = scene.snapshot()

    expect(isRigDetailView(snapshot.rig), `${name} rig`).toBe(true)
    expect(isHomeView({ rigs: snapshot.rigs, refreshedAt: scene.time }), `${name} home`).toBe(true)
    expect(isImagingCameraView(snapshot.camera, 'fra400'), `${name} camera`).toBe(true)
    expect(isFramingView(snapshot.framing, 'fra400'), `${name} framing`).toBe(true)
    expect(isRigObservationView(scene.respond('GET', '/api/web/rigs/fra400/observe').json), name).toBe(true)
    expect(scene.writes).toEqual([])
    expect(scene.unknownRequests).toEqual([])
  }
})

test('connection results satisfy production contracts and uncertain response can be inspected', () => {
  for (const name of ['equipment-connect-outcomes', 'equipment-connect-partial', 'equipment-connect-rejected'] as const) {
    const scene = createEquipmentScene(name)
    const result = scene.respond('POST', '/api/rigs/fra400/connections')

    expect(isConnectRigDevicesResult(result.json), name).toBe(true)
  }

  const scene = createEquipmentScene('equipment-connect-unconfirmed')

  expect(scene.respond('POST', '/api/rigs/fra400/connections').status).toBe(503)
  expect(scene.respond('GET', '/api/web/rigs/fra400/observe').json).toMatchObject({ connectionPreparation: { state: 'complete' } })
  expect(scene.writes).toHaveLength(1)
})

test('unconfirmed settings preserve applied state without replay and partial saves remain separate', () => {
  const scene = createEquipmentScene('equipment-setup-unconfirmed')
  const choice = { id: 'other-camera', name: 'ZWO ASI220MM Mini' }

  expect(scene.respond('PUT', '/api/rigs/fra400/imaging-camera', choice).status).toBe(503)
  expect(scene.respond('GET', '/api/web/rigs/fra400/imaging-camera').json).toMatchObject({ selected: choice })
  expect(scene.snapshot().framing.focalLengthMm).toBe(400)
  expect(scene.writes).toHaveLength(1)

  const partial = createEquipmentScene('equipment-setup-partial')

  expect(partial.respond('PUT', '/api/rigs/fra400/imaging-camera', choice).status).toBe(200)
  expect(partial.respond('PUT', '/api/rigs/fra400/framing/settings', { focalLengthMm: 500 }).status).toBe(409)
  expect(partial.snapshot().camera.selected).toEqual(choice)
  expect(partial.snapshot().framing.focalLengthMm).toBe(400)
})

test('add inspection reports the applied endpoint identity and rejection never creates it', () => {
  for (const name of ['rig-add-unconfirmed', 'rig-add-conflict'] as const) {
    const scene = createEquipmentScene(name)
    const request = { name: 'My rig', endpoint: { host: '192.168.4.104', port: 11111 } }

    scene.respond('POST', '/api/rigs', request)

    const result = scene.respond('POST', '/api/rigs/discovery', { mode: 'manual', ...request.endpoint })
    const disposition = name === 'rig-add-unconfirmed' ? { state: 'already-added', rigId: 'fra400' } : { state: 'new' }

    expect(result.json).toMatchObject({ candidates: [{ disposition }] })
    expect(scene.writes.filter(write => write.pathname === '/api/rigs')).toHaveLength(1)
  }
})

test('unconfirmed forget can be resolved by catalog inspection and unknown requests are blocked', () => {
  const scene = createEquipmentScene('rig-forget-unconfirmed')

  expect(scene.respond('DELETE', '/api/rigs/fra400').status).toBe(503)
  expect(scene.respond('GET', '/api/web/home').json).toMatchObject({ rigs: [] })
  expect(scene.respond('GET', '/api/web/rigs/fra400').status).toBe(404)
  expect(scene.writes).toHaveLength(1)
  expect(scene.respond('POST', '/api/rigs/fra400/move').status).toBe(501)
  expect(scene.unknownRequests).toEqual(['POST /api/rigs/fra400/move'])
})
