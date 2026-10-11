import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import type { MountControl, MountControlObservation } from '@vela/equipment'
import type {
  MountControlAction,
  MountControlAvailability,
  MountControlView,
  RigDetailView,
  RigTelescopeDeviceView,
} from '@vela/model/web'
import type { RigCatalog } from './catalog.js'
import type { RigCatalogRecord } from './contracts.js'
import { inspectRigDetail, type RigDetailOptions } from './detail.js'
import type { RigOperations } from './operations.js'
import { rigDeviceId } from '../web/rig-detail.js'

interface MountControlOptions {
  createMountControl(rig: RigCatalogRecord): MountControl
  createInspector: NonNullable<RigDetailOptions['createInspector']>
}

interface CommandRecord {
  expectedTelescopeName: string
  view: NonNullable<MountControlView['command']>
  release?: () => void
}

const requestSchema = z.strictObject({
  deviceId: z.string().min(1),
  requestId: z.uuid(),
  serverInstanceId: z.uuid(),
  action: z.enum(['unpark', 'tracking-on', 'tracking-off']),
})

function disabled(reason: string): MountControlAvailability {
  return { enabled: false, reason }
}

function requestedState(action: MountControlAction, observation: MountControlObservation) {
  return action === 'unpark' ? observation.parked : observation.tracking
}

function matches(action: MountControlAction, observation: MountControlObservation) {
  return requestedState(action, observation) === (action === 'tracking-on')
}

function currentMountView(
  device: RigTelescopeDeviceView,
  observation: MountControlObservation | undefined,
): RigTelescopeDeviceView {
  if (!observation || device.connection !== 'connected') return device

  const tracking = observation.tracking === undefined ? 'unknown' : observation.tracking ? 'on' : 'off'
  const parking = observation.parked === undefined ? 'unknown' : observation.parked ? 'parked' : 'unparked'
  let activity: 'idle' | 'tracking' | 'slewing' | 'parked' | 'unknown' = 'unknown'

  if (observation.slewing) activity = 'slewing'
  else if (observation.parked) activity = 'parked'
  else if (observation.tracking) activity = 'tracking'
  else if (observation.slewing === false && observation.parked === false && observation.tracking === false) activity = 'idle'

  return {
    ...device,
    observedAt: observation.observedAt ?? device.observedAt,
    status: {
      availability: tracking === 'unknown' || parking === 'unknown' || observation.slewing === undefined || device.status.availability !== 'complete'
        ? 'partial' : 'complete',
      tracking,
      parking,
      activity,
      home: device.status.availability === 'complete' || device.status.availability === 'partial' ? device.status.home : 'unknown',
    },
  }
}

/** One explicit write, retained across browser disconnects until its result is known. */
export function registerMountControls(
  app: FastifyInstance,
  catalog: RigCatalog,
  operations: RigOperations,
  options: MountControlOptions,
) {
  const serverInstanceId = randomUUID()
  const commands = new Map<string, CommandRecord>()
  const admittedRequests = new Set<string>()
  const retiredRequests = new Set<string>()
  const key = (rigId: string, deviceId: string) => JSON.stringify([rigId, deviceId])

  function reconcile(
    command: CommandRecord | undefined,
    observation: MountControlObservation | undefined,
    telescopeName: string,
  ) {
    if (command?.view.state !== 'uncertain' || !observation || observation.slewing !== false) return

    if (command.expectedTelescopeName !== telescopeName) return

    if (requestedState(command.view.action, observation) === undefined) return

    const confirmed = matches(command.view.action, observation)
    command.view = {
      requestId: command.view.requestId,
      action: command.view.action,
      state: confirmed ? 'confirmed' : 'failed',
      message: confirmed
        ? 'The requested mount state is now confirmed.'
        : 'Fresh mount readings confirm the requested state was not reached.',
    }
    command.release?.()
    delete command.release
  }

  function controls(
    rigId: string,
    device: RigTelescopeDeviceView,
    observation: MountControlObservation | undefined,
    ownsLane = false,
  ): MountControlView {
    const command = commands.get(key(rigId, device.id))
    reconcile(command, observation, device.name)
    let reason: string | undefined

    if (command?.view.state === 'pending') reason = 'Waiting for the mount command to finish.'
    else if (command?.view.state === 'uncertain') reason = 'The previous command is uncertain. Waiting for fresh mount readings; no command will be repeated.'
    else if (!ownsLane && operations.owner(rigId)) reason = 'Wait for the active rig operation to finish.'
    else if (device.connection !== 'connected') reason = 'Connect the mount before changing its state.'
    else if (device.observation?.state === 'interrupted' || device.observation?.commandReady === false || !observation)
      reason = 'Fresh mount readings are unavailable.'
    else if (observation.slewing !== false)
      reason = observation.slewing ? 'Wait for the mount to stop slewing.' : 'Mount motion is unknown.'

    if (reason) {
      return { serverInstanceId, unpark: disabled(reason), trackingOn: disabled(reason), trackingOff: disabled(reason), command: command?.view ?? null }
    }

    const state = observation!
    const enabled: MountControlAvailability = { enabled: true, reason: null }
    const trackingSupport = state.canSetTracking === true

    const unpark = state.canUnpark !== true
      ? disabled('This mount does not report unpark support.')
      : state.parked === undefined
        ? disabled('Mount parking state is unknown.')
        : state.parked ? enabled : disabled('The mount is already unparked.')

    let trackingOn: MountControlAvailability
    let trackingOff: MountControlAvailability

    if (!trackingSupport) {
      trackingOn = trackingOff = disabled('This mount does not report tracking control support.')
    } else if (state.tracking === undefined) {
      trackingOn = trackingOff = disabled('Mount tracking state is unknown.')
    } else {
      trackingOff = state.tracking ? enabled : disabled('Tracking is already off.')
      trackingOn = state.parked === true
        ? disabled('Unpark the mount before turning tracking on.')
        : state.parked === undefined
          ? disabled('Mount parking state is unknown.')
          : state.tracking ? disabled('Tracking is already on.') : enabled
    }

    return { serverInstanceId, unpark, trackingOn, trackingOff, command: command?.view ?? null }
  }

  async function decorate(view: RigDetailView): Promise<RigDetailView> {
    const rig = await catalog.get(view.id)

    if (!rig) return view

    const devices = await Promise.all(view.devices.map(async device => {
      if (device.kind !== 'telescope') return device

      const identity = rig.lastObservedInventory.devices.find(item =>
        item.kind === 'telescope' && rigDeviceId(rig.id, item.uniqueId) === device.id && item.name === device.configuredName,
      )

      let observation: MountControlObservation | undefined
      const pending = commands.get(key(rig.id, device.id))?.view.state === 'pending'

      if (identity && !pending && device.connection === 'connected' && device.observation?.state !== 'interrupted') {
        try {
          observation = await options.createMountControl(rig).observe(identity.uniqueId)
        } catch {
          observation = undefined
        }
      }

      const current = currentMountView(device, observation)

      return { ...current, mountControl: controls(rig.id, current, observation) }
    }))

    return { ...view, devices }
  }

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/mount/check', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body)

    if (!parsed.success) return reply.code(400).send({ error: 'invalid-mount-command' })
    const { rigId } = request.params
    const { deviceId, requestId } = parsed.data
    const rig = await catalog.get(rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    const identity = rig.lastObservedInventory.devices.find(device =>
      device.kind === 'telescope' && rigDeviceId(rigId, device.uniqueId) === deviceId,
    )

    if (!identity) return reply.code(404).send({ error: 'mount-not-found' })
    let admission: 'known' | 'not-admitted' | 'unknown' = 'unknown'

    if (parsed.data.serverInstanceId === serverInstanceId)
      admission = admittedRequests.has(requestId) ? 'known' : 'not-admitted'

    // Retire before reading: a delayed original request must fail its final admission check.
    if (admission !== 'known') retiredRequests.add(requestId)
    const detail = await inspectRigDetail(catalog, rigId, { createInspector: options.createInspector })

    if (detail.state === 'not-found') return reply.code(404).send({ error: 'rig-not-found' })
    const view = await decorate(detail.view)
    const mount = view.devices.find(device => device.kind === 'telescope' && device.id === deviceId)

    if (mount?.kind !== 'telescope' || !mount.mountControl)
      return reply.code(409).send({ error: 'mount-unavailable', message: 'Fresh mount identity is unavailable.' })

    return { admission, control: mount.mountControl }
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/mount', async (request, reply) => {
    const parsed = requestSchema.safeParse(request.body)

    if (!parsed.success) return reply.code(400).send({ error: 'invalid-mount-command' })
    const { rigId } = request.params
    const { deviceId, action, requestId } = parsed.data

    if (parsed.data.serverInstanceId !== serverInstanceId)
      return reply.code(409).send({ error: 'mount-server-restarted', message: 'Vela restarted. Refresh Your Rig before issuing a new mount command.' })

    if (retiredRequests.has(requestId))
      return reply.code(409).send({ error: 'mount-command-retired' })

    if (admittedRequests.has(requestId))
      return reply.code(409).send({ error: 'mount-command-already-admitted' })
    const rig = await catalog.get(rigId)

    if (!rig) return reply.code(404).send({ error: 'rig-not-found' })

    // Acquire before inspecting so another workflow cannot start between preflight and write.
    const release = operations.acquire(rigId, 'mount-control')

    if (!release) return reply.code(409).send({ error: 'rig-operation-in-progress' })
    let retainOwnership = false

    try {
      const detail = await inspectRigDetail(catalog, rigId, { createInspector: options.createInspector })

      if (detail.state !== 'current')
        return reply.code(409).send({ error: 'mount-unavailable', message: 'Fresh rig identity and readings are required.' })

      const device = detail.view.devices.find(item => item.id === deviceId)
      const inspection = detail.inspections.find(item => rigDeviceId(rigId, item.providerDeviceId) === deviceId)

      if (device?.kind !== 'telescope' || inspection?.kind !== 'telescope')
        return reply.code(404).send({ error: 'mount-not-found' })

      const adapter = options.createMountControl(rig)
      const observation = await adapter.observe(inspection.providerDeviceId).catch(() => undefined)

      // This request owns the lane; controls uses owner state only for other workflows.
      const readiness = controls(rigId, device, observation, true)

      const available = {
        unpark: readiness.unpark,
        'tracking-on': readiness.trackingOn,
        'tracking-off': readiness.trackingOff,
      }[action]

      if (!available.enabled)
        return reply.code(409).send({ error: 'mount-command-unavailable', message: available.reason })

      if (retiredRequests.has(requestId))
        return reply.code(409).send({ error: 'mount-command-retired' })

      if (admittedRequests.has(requestId))
        return reply.code(409).send({ error: 'mount-command-already-admitted' })

      const command: CommandRecord = {
        expectedTelescopeName: inspection.name,
        view: { requestId, action, state: 'pending', message: null },
      }

      admittedRequests.add(requestId)
      commands.set(key(rigId, deviceId), command)

      let confirmedObservation: MountControlObservation | undefined

      try {
        const identity = { telescopeId: inspection.providerDeviceId, expectedTelescopeName: inspection.name }

        const result = await adapter.execute(action === 'unpark'
          ? { ...identity, kind: 'unpark' }
          : { ...identity, kind: 'set-tracking', tracking: action === 'tracking-on' })

        if (result.outcome === 'confirmed') confirmedObservation = result.observation
        command.view = {
          requestId,
          action,
          state: result.outcome,
          message: result.outcome === 'confirmed'
            ? null
            : result.message ?? 'The mount did not confirm the requested change. Check its current state before trying again.',
        }
      } catch (error) {
        request.log.warn({ err: error, rigId, deviceId }, 'Mount command outcome is uncertain')
        command.view = { requestId, action, state: 'uncertain', message: 'The mount command could not be confirmed. Waiting for fresh readings.' }
      }

      if (command.view.state === 'uncertain') {
        command.release = release
        retainOwnership = true
      }

      return controls(rigId, device, confirmedObservation, true)
    } finally {
      if (!retainOwnership) release()
    }
  })

  return { decorate, serverInstanceId }
}
