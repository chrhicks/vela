import type { DiscoveryResultView, RigView } from '@vela/model/rig'
import type {
  ConnectRigDevicesResult, FramingView, HomeView, ImagingCameraView,
  RigDetailView, RigDeviceDetailView, RigObservationView,
} from '@vela/model/web'
import { reviewFraming } from './explore'
import { reviewTime, reviewTimezone, type ReviewResponse } from './tonight'

export const equipmentScenes = [
  'equipment-connected', 'equipment-dark', 'equipment-camera-disconnected',
  'equipment-details-all-kinds', 'equipment-read-interrupted', 'equipment-initial-failure',
  'equipment-not-found', 'equipment-offline', 'equipment-empty',
  'equipment-connect-outcomes', 'equipment-connect-partial', 'equipment-connect-rejected',
  'equipment-connect-unconfirmed', 'equipment-setup-save', 'equipment-setup-partial',
  'equipment-setup-unconfirmed', 'equipment-camera-changed', 'equipment-camera-busy',
  'home-no-rigs', 'home-no-rigs-dark', 'home-rigs', 'home-rigs-dark', 'home-initial-failure',
  'rig-discovery-review', 'rig-discovery-empty', 'rig-discovery-failed',
  'rig-address-unreachable', 'rig-address-validation-phone', 'rig-dialog-submission',
  'rig-add-conflict', 'rig-add-refresh-failed', 'rig-add-unconfirmed',
  'rig-forget-dialog', 'rig-forget-focus-return', 'rig-forget-failed', 'rig-forget-unconfirmed',
] as const

export type EquipmentScene = (typeof equipmentScenes)[number]

export type EquipmentWriteOutcome = 'confirmed' | 'rejected' | 'unconfirmed'

export type EquipmentOperation = 'detail' | 'home' | 'discovery' | 'connect' | 'camera' | 'focal' | 'add' | 'forget'

interface ReviewCommand {
  id?: string
  name?: string
  focalLengthMm?: number
  endpoint?: { host: string; port: number }
  mode?: 'scan' | 'manual'
  host?: string
  port?: number
}

type ReviewPayload = ReviewResponse['json']

const identity = (id: string, name: string) => ({ id: `fra400-${id}`, name, configuredName: name, observedAt: reviewTime })

export const equipmentRig: RigDetailView = {
  id: 'fra400', name: 'Askar FRA 400', state: 'reachable',
  endpoint: { host: '192.168.4.104', port: 11111 }, addedAt: reviewTime,
  lastInventoryAt: reviewTime, refreshedAt: reviewTime, capabilities: ['forget'],
  connections: { total: 4, connected: 3, disconnected: 1, unavailable: 0 },
  devices: [
    { ...identity('camera', 'ZWO ASI2600MC Pro'), kind: 'camera', connection: 'connected',
      status: { availability: 'complete', activity: 'idle', sensorTemperatureC: -10,
        cooling: { state: 'on', powerPercent: 38 } } },
    { ...identity('mount', 'ASI Mount'), kind: 'telescope', connection: 'connected',
      status: { availability: 'complete', activity: 'tracking', tracking: 'on', parking: 'unparked', home: 'away' } },
    { ...identity('focuser', 'ZWO Focuser'), kind: 'focuser', connection: 'connected',
      status: { availability: 'complete', activity: 'idle', position: 32842 } },
    { ...identity('other-camera', 'ZWO ASI220MM Mini'), kind: 'camera', connection: 'disconnected',
      status: { availability: 'unavailable' } },
  ],
}

const extraDevices: RigDeviceDetailView[] = [
  { ...identity('filter-wheel', 'Filter wheel'), kind: 'filter-wheel', connection: 'connected',
    status: { availability: 'complete', activity: 'idle', position: 2, filterName: 'L-Ultimate' } },
  { ...identity('conditions', 'Observing conditions'), kind: 'observing-conditions', connection: 'connected',
    status: { availability: 'partial', activity: 'reporting', temperatureC: 12, humidityPercent: 64 } },
  { ...identity('switch', 'Power controller'), kind: 'switch', connection: 'connected',
    status: { availability: 'partial', activity: 'reporting', channels: [
      { id: 0, name: 'Camera power', on: true, value: 12 },
      { id: 1, name: 'Dew heater', value: 0.35 }, { id: 2, name: 'Unknown channel' },
    ] } },
  ...(['cover-calibrator', 'dome', 'rotator', 'safety-monitor', 'unknown'] as const).map(kind => ({
    ...identity(kind, `${kind} review device`), kind, connection: 'connected' as const,
    status: { availability: 'unsupported' as const },
  })),
]

function summarize(rig: RigDetailView): RigDetailView {
  return { ...rig, connections: {
    total: rig.devices.length,
    connected: rig.devices.filter(device => device.connection === 'connected').length,
    disconnected: rig.devices.filter(device => device.connection === 'disconnected').length,
    unavailable: rig.devices.filter(device => device.connection === 'unavailable').length,
  } }
}

function catalogRig(rig: RigDetailView): RigView {
  return { id: rig.id, name: rig.name, reachability: rig.state === 'offline' ? 'unreachable' : 'reachable',
    lastSeenAt: rig.refreshedAt, connections: rig.connections, capabilities: rig.capabilities }
}

/** Actual API contracts, isolated mutable state per review session, no network fallback. */
export function createEquipmentScene(name: EquipmentScene) {
  let rig = structuredClone(equipmentRig)
  const startsEmpty = name.startsWith('rig-') && !name.startsWith('rig-forget') || name.startsWith('home-no-rigs')
  let rigs: RigView[] = startsEmpty ? [] : [catalogRig(rig)]
  let detailFailure: number | null = null

  if (name === 'equipment-initial-failure') detailFailure = 503

  if (name === 'equipment-not-found') detailFailure = 404
  let homeFailure: number | null = name === 'home-initial-failure' ? 503 : null
  let interrupted = name === 'equipment-read-interrupted'
  let connectionOutcome: 'complete' | 'partial' | 'rejected' | 'unconfirmed' = 'complete'

  if (name === 'equipment-connect-partial') connectionOutcome = 'partial'

  if (name === 'equipment-connect-rejected') connectionOutcome = 'rejected'

  if (name === 'equipment-connect-unconfirmed') connectionOutcome = 'unconfirmed'

  const outcomes: Record<'camera' | 'focal' | 'add' | 'forget', EquipmentWriteOutcome> = {
    camera: 'confirmed', focal: 'confirmed', add: 'confirmed', forget: 'confirmed',
  }

  if (name === 'equipment-setup-unconfirmed') outcomes.camera = 'unconfirmed'

  if (name === 'equipment-setup-partial') outcomes.focal = 'rejected'

  if (name === 'rig-add-conflict') outcomes.add = 'rejected'

  if (name === 'rig-add-unconfirmed') outcomes.add = 'unconfirmed'

  if (name === 'rig-forget-failed') outcomes.forget = 'rejected'

  if (name === 'rig-forget-unconfirmed') outcomes.forget = 'unconfirmed'
  const delays: Partial<Record<EquipmentOperation, number>> = {}
  const unknownRequests: string[] = []
  const writes: Array<{ method: string; pathname: string; body: unknown }> = []
  let detailReads = 0
  let homeReads = 0

  let camera: ImagingCameraView = { rigId: rig.id,
    selected: { id: 'camera', name: 'ZWO ASI2600MC Pro' }, selectedDeviceId: 'fra400-camera',
    cameras: rig.devices.filter(device => device.kind === 'camera').map(({ id, name: cameraName, configuredName }) => ({ id: id.slice(`${rig.id}-`.length), name: cameraName, configuredName })),
    state: 'ready', editable: name !== 'equipment-camera-busy' }

  let framing: FramingView = { ...structuredClone(reviewFraming), phase: 'idle', active: false,
    actual: null, preview: null, desired: null, targetId: null, canCenter: false, checkCurrent: false }

  if (name === 'equipment-camera-changed') {
    camera = { ...camera, state: 'changed', selectedDeviceId: null, cameras: camera.cameras.map(choice => choice.id === 'camera' ? { ...choice, name: 'Replacement camera' } : choice) }
  }

  if (name === 'equipment-camera-disconnected' || name.startsWith('equipment-connect-')) {
    rig = summarize({ ...rig, devices: rig.devices.map(device => device.kind === 'camera'
      ? { ...device, connection: 'disconnected', observedAt: reviewTime, status: { availability: 'unavailable' } } : device) })
  }

  if (name === 'equipment-details-all-kinds') {
    rig = summarize({ ...rig, devices: [...rig.devices.map(device => device.kind === 'focuser'
      ? { ...device, connection: 'connected' as const, observedAt: reviewTime, status: { availability: 'partial' as const, activity: 'unknown' as const, temperatureC: 11.2 } }
      : device), ...structuredClone(extraDevices)] })
  }

  if (name === 'equipment-offline') rig = summarize({ ...rig, state: 'offline', devices: rig.devices.map(device => ({ ...device, connection: 'unavailable', status: { availability: 'unavailable' } })) })

  if (name === 'equipment-empty') rig = summarize({ ...rig, devices: [] })

  if (!startsEmpty) rigs = [catalogRig(rig)]

  if (name.startsWith('home-rigs')) rigs.push(
    { ...catalogRig(rig), id: 'seestar', name: 'Seestar', reachability: 'unreachable', connections: { total: 2, connected: 0, disconnected: 0, unavailable: 2 } },
    { id: 'portable', name: 'Portable rig', reachability: 'unknown', connections: { total: 0, connected: 0, disconnected: 0, unavailable: 0 }, capabilities: ['forget'] },
  )

  if (name === 'rig-dialog-submission') delays.add = 2500

  if (name === 'equipment-connect-outcomes') delays.connect = 2000

  let discovery: DiscoveryResultView = { candidates: [{ endpoint: rig.endpoint, inspectedAt: reviewTime,
    server: { name: 'Askar FRA 400' }, devices: rig.devices.map(({ kind, name: deviceName }) => ({ kind, name: deviceName })),
    disposition: { state: 'new' } }], failures: [] }

  if (name === 'rig-discovery-empty') discovery = { candidates: [], failures: [] }

  if (name === 'rig-discovery-failed') discovery = { candidates: [], failures: [{ reason: 'scan-failed' }] }

  if (name === 'rig-address-unreachable') discovery = { candidates: [], failures: [{ endpoint: rig.endpoint, reason: 'unreachable' }] }

  function observation(): RigObservationView {
    return { rig: structuredClone(rig), connectionPreparation:
      rig.state === 'offline' || rig.devices.length === 0 ? { state: 'unavailable', capabilities: [] } :
        rig.connections.disconnected > 0 ? { state: 'available', capabilities: ['connect-devices'] } : { state: 'complete', capabilities: [] } }
  }

  function response(operation: EquipmentOperation, status: number, json?: ReviewPayload): ReviewResponse {
    const result: ReviewResponse = { status }

    if (json !== undefined) result.json = structuredClone(json)

    if (delays[operation]) result.delayMs = delays[operation]

    return result
  }

  function saveResponse(operation: 'camera' | 'focal' | 'add' | 'forget', json?: ReviewPayload): ReviewResponse {
    if (outcomes[operation] === 'unconfirmed') return response(operation, 503, { error: 'review-response-lost' })

    if (operation === 'add') return response(operation, 201, json)

    if (operation === 'forget') return response(operation, 204)

    return response(operation, 200, json)
  }

  function reject(operation: EquipmentOperation): ReviewResponse {
    return response(operation, 409, { error: operation === 'add' ? 'rig-conflict' : 'review-write-rejected' })
  }

  function respond(method: string, pathname: string, body?: ReviewCommand): ReviewResponse {
    if (method === 'GET' && pathname === '/api/web/navigation') return { status: 200, json: { rigs: rigs.map(({ id, name: rigName }) => ({ id, name: rigName })), captures: [] } }

    if (method === 'GET' && pathname === '/api/web/home') {
      homeReads++

      return homeFailure ? response('home', homeFailure, { error: 'review-home-unavailable' }) : response('home', 200, { rigs, refreshedAt: reviewTime } satisfies HomeView)
    }

    if (method === 'GET' && (pathname === '/api/web/rigs/seestar' || pathname === '/api/web/rigs/portable')) {
      const saved = rigs.find(candidate => pathname === `/api/web/rigs/${candidate.id}`)

      if (!saved) return response('detail', 404, { error: 'rig-not-found' })
      const devices: RigDeviceDetailView[] = saved.id === 'seestar' ? rig.devices.slice(0, 2).map(device => ({ ...device, connection: 'unavailable', status: { availability: 'unavailable' } })) : []

      return response('detail', 200, summarize({ ...rig, id: saved.id, name: saved.name, state: 'offline', devices }))
    }

    if (method === 'GET' && pathname === '/api/web/rigs/fra400') {
      detailReads++
      const failure = detailFailure ?? (interrupted && detailReads > 2 ? 503 : null)

      return failure ? response('detail', failure, { error: 'review-detail-unavailable' }) : response('detail', 200, rig)
    }

    if (method === 'GET' && pathname === '/api/web/rigs/fra400/observe') return response('detail', 200, observation())

    if (method === 'GET' && pathname === '/api/web/rigs/fra400/imaging-camera') return response('camera', 200, camera)

    if (method === 'GET' && pathname === '/api/web/rigs/fra400/framing') return response('focal', 200, framing)

    if (method === 'POST' && pathname === '/api/rigs/discovery') {
      writes.push({ method, pathname, body: structuredClone(body) })

      return response('discovery', 200, discovery)
    }

    if (method === 'POST' && pathname === '/api/rigs/fra400/connections') {
      writes.push({ method, pathname, body: structuredClone(body) })
      const disconnected = rig.devices.filter(device => device.connection === 'disconnected')
      const first = disconnected[0]

      if (!first) return response('connect', 200, { outcome: 'complete', command: 'not-needed', confirmedConnected: [], view: observation() } satisfies ConnectRigDevicesResult)

      if (connectionOutcome === 'rejected') return response('connect', 200, { outcome: 'failed', confirmedConnected: [], failed: { ...first, reason: 'rejected' }, notAttempted: disconnected.slice(1), view: observation() } satisfies ConnectRigDevicesResult)
      const connectedIds = connectionOutcome === 'partial' ? [first.id] : disconnected.map(device => device.id)
      rig = summarize({ ...rig, devices: rig.devices.map(device => connectedIds.includes(device.id) && device.kind === 'camera'
        ? { ...device, connection: 'connected', observedAt: reviewTime, status: { availability: 'partial', activity: 'idle' } } : device) })
      rigs = rigs.map(saved => saved.id === rig.id ? catalogRig(rig) : saved)

      if (connectionOutcome === 'unconfirmed') return response('connect', 503, { error: 'review-response-lost' })
      const second = disconnected[1]

      if (connectionOutcome === 'partial' && second) return response('connect', 200, { outcome: 'partial', confirmedConnected: [first], failed: { ...second, reason: 'rejected' }, notAttempted: [], view: observation() } satisfies ConnectRigDevicesResult)

      return response('connect', 200, { outcome: 'complete', command: 'completed', confirmedConnected: [first, ...disconnected.slice(1)], view: observation() } satisfies ConnectRigDevicesResult)
    }

    if (method === 'PUT' && pathname === '/api/rigs/fra400/imaging-camera') {
      writes.push({ method, pathname, body: structuredClone(body) })

      if (outcomes.camera === 'rejected') return reject('camera')
      const selected = camera.cameras.find(choice => choice.id === body?.id && choice.name === body?.name)

      if (!selected?.name || !camera.editable) return reject('camera')
      camera = { ...camera, selected: { id: selected.id, name: selected.name }, selectedDeviceId: `${rig.id}-${selected.id}`, state: 'ready' }

      return saveResponse('camera', camera)
    }

    if (method === 'PUT' && pathname === '/api/rigs/fra400/framing/settings') {
      writes.push({ method, pathname, body: structuredClone(body) })

      if (outcomes.focal === 'rejected') return reject('focal')
      const focal = body?.focalLengthMm

      if (focal === undefined || !Number.isFinite(focal) || focal < 10 || focal > 20000) return response('focal', 400, { error: 'invalid-settings' })
      framing = { ...framing, focalLengthMm: focal }

      return saveResponse('focal', framing)
    }

    if (method === 'POST' && pathname === '/api/rigs') {
      writes.push({ method, pathname, body: structuredClone(body) })

      if (outcomes.add === 'rejected') return reject('add')
      const rigName = body?.name

      if (!rigName?.trim() || rigs.some(saved => saved.id === rig.id)) return reject('add')
      rig = { ...rig, name: rigName.trim() }
      rigs = [...rigs, catalogRig(rig)]
      discovery = { ...discovery, candidates: discovery.candidates.map(candidate => ({ ...candidate, disposition: { state: 'already-added', rigId: rig.id } })) }

      if (name === 'rig-add-refresh-failed') homeFailure = 503

      return saveResponse('add', { rigId: rig.id })
    }

    if (method === 'DELETE' && pathname === '/api/rigs/fra400') {
      writes.push({ method, pathname, body: structuredClone(body) })

      if (outcomes.forget === 'rejected') return reject('forget')
      rigs = rigs.filter(saved => saved.id !== rig.id)
      detailFailure = 404

      return saveResponse('forget')
    }

    unknownRequests.push(`${method} ${pathname}`)

    return { status: 501, json: { error: 'unmapped-equipment-review-request', method, pathname } }
  }

  return {
    name, route: name.startsWith('equipment-') || name.startsWith('rig-forget') ? '/rigs/fra400' : '/',
    time: reviewTime, timezone: reviewTimezone, appearance: name.endsWith('-dark') ? 'dark' as const : 'light' as const,
    respond, unknownRequests, writes, get detailReads() { return detailReads }, get homeReads() { return homeReads },
    snapshot: () => ({ rig: structuredClone(rig), rigs: structuredClone(rigs), camera: structuredClone(camera), framing: structuredClone(framing) }),
    setDetailFailure(status: number | null) { detailFailure = status; interrupted = false },
    setHomeFailure(status: number | null) { homeFailure = status },
    setRig(value: RigDetailView) { rig = summarize(structuredClone(value)) },
    setCamera(value: ImagingCameraView) { camera = structuredClone(value) },
    setDiscovery(value: DiscoveryResultView) { discovery = structuredClone(value) },
    setConnectionOutcome(value: typeof connectionOutcome) { connectionOutcome = value },
    setWriteOutcome(operation: keyof typeof outcomes, value: EquipmentWriteOutcome) { outcomes[operation] = value },
    setDelay(operation: EquipmentOperation, ms: number) { delays[operation] = Math.max(0, Math.min(60000, ms)) },
  }
}
