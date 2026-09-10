import type { FastifyInstance } from 'fastify'
import { createAlpacaAcquisition, createAlpacaFraming, type AlpacaFraming } from '@vela/alpaca'
import type { FramingView, TargetView, TargetsView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import type { RigOperations } from '../rig/operations.js'
import { inspectRigDetail, type RigDetailOptions } from '../rig/detail.js'
import { createAstapSolver, type PlateSolver } from '../plate-solving/solver.js'
import { createFramingController, mountSite, type FramingHardware } from './framing.js'
import { getTarget, listTargets, normalizeCatalogName, type CatalogTarget } from './catalog/index.js'
import { skyPath, type Site } from './sky.js'
import { registerTargetDiscovery } from './discovery-routes.js'

export interface TargetOptions {
  solver?: { executable: string, catalogPath: string }
  createAdapter?: (endpoint: string) => AlpacaFraming
  createHardware?: (rig: RigCatalogRecord, telescopeId: string) => FramingHardware
  createSolver?: (fieldHeightDegrees: number) => PlateSolver
  createInspector?: RigDetailOptions['createInspector']
  now?: () => Date
}

export function registerTargets(app: FastifyInstance, catalog: RigCatalog, operations: RigOperations, options: TargetOptions = {}) {
  const now = options.now ?? (() => new Date())
  const controllers = new Map<string, ReturnType<typeof createFramingController>>()
  const adapters = new Map<string, AlpacaFraming>()

  function adapter(rig: RigCatalogRecord) {
    const endpoint = `http://${rig.endpoint.host}:${rig.endpoint.port}`
    let value = adapters.get(endpoint)

    if (!value) {
      value = options.createAdapter?.(endpoint) ?? createAlpacaFraming({ baseUrl: endpoint })
      adapters.set(endpoint, value)
    }

    return value
  }

  function mountId(rig: RigCatalogRecord) {
    const mounts = rig.lastObservedInventory.devices.filter(device => device.kind === 'telescope')

    if (mounts.length !== 1) throw new Error('Framing requires one unambiguous telescope in this rig.')

    return mounts[0]!.uniqueId
  }

  async function readiness(rig: RigCatalogRecord) {
    if (!rig.imagingCamera) throw new Error('Choose an imaging camera on Observe before framing.')
    const detail = await inspectRigDetail(catalog, rig.id, options.createInspector ? { createInspector: options.createInspector } : {})

    if (detail.state !== 'current') throw new Error('Rig identity or connection needs attention before framing.')
    const camera = detail.inspections.find(item => item.providerDeviceId === rig.imagingCamera!.uniqueId && item.kind === 'camera')

    if (!camera || camera.connection !== 'connected' || camera.name?.trim() !== rig.imagingCamera.name) throw new Error('The selected imaging camera is disconnected or its identity changed.')

    if (!controllers.get(rig.id)?.snapshot().active && (camera.telemetry.values?.kind !== 'camera' || camera.telemetry.values.activity !== 'idle')) throw new Error('The camera has not confirmed it is idle.')
    const telescopeId = mountId(rig)
    const device = adapter(rig)

    const [geometry, mount] = await Promise.all([
      device.cameraGeometry({ cameraId: rig.imagingCamera.uniqueId, expectedCameraName: rig.imagingCamera.name }),
      device.telescopeStatus(telescopeId),
    ])

    const site = mountSite(mount)

    if (mount.coordinateSystem !== 'j2000' && mount.coordinateSystem !== 'topocentric') throw new Error(`Mount coordinate frame ${mount.coordinateSystem} is not supported for framing.`)

    if (!rig.focalLengthMm) throw new Error('Set the effective focal length to calibrate your camera frame.')
    const field = (pixels: number, microns: number, bin: number) => 2 * Math.atan(pixels * microns * bin / 2000 / rig.focalLengthMm!) * 180 / Math.PI

    const cameraView = { name: geometry.cameraName, width: geometry.width, height: geometry.height,
      fieldWidthDegrees: field(geometry.width, geometry.pixelWidthMicrons, geometry.binX),
      fieldHeightDegrees: field(geometry.height, geometry.pixelHeightMicrons, geometry.binY) }

    const configuration = JSON.stringify([rig.endpoint, rig.imagingCamera, rig.focalLengthMm, geometry, telescopeId])

    return { mount, site, camera: cameraView, configuration, telescopeId }
  }

  async function framingView(rig: RigCatalogRecord): Promise<FramingView> {
    let ready: Awaited<ReturnType<typeof readiness>> | undefined
    let unavailableReason: string | null = null

    try {
      ready = await readiness(rig)
    } catch (error) {
      unavailableReason = message(error)
    }

    // Inspection can span an operation transition. Read the controller and its
    // check flags together after that await so every field describes one state.
    const controller = controllers.get(rig.id)
    const state = controller?.snapshot() ?? createFramingController(now).snapshot()
    const view: FramingView = { ...state, rigId: rig.id, rigName: rig.name, observedAt: now().toISOString(), enabled: false, unavailableReason, focalLengthMm: rig.focalLengthMm ?? null, camera: null, canCenter: false, checkCurrent: false }

    if (!ready) return view
    const owner = operations.owner(rig.id)

    const reason = owner && owner !== 'framing' ? 'Another rig operation is in progress.'
      : ready.mount.parked ? 'Unpark the mount before framing.'
        : ready.mount.slewing && !state.active ? 'The mount is already moving.'
          : !options.solver && !options.createSolver ? 'Plate solving is not configured on the Vela server.' : null

    return { ...view, camera: ready.camera, enabled: !reason, unavailableReason: reason,
      checkCurrent: !reason && (controller?.checkCurrent(ready.mount, ready.configuration) ?? false),
      canCenter: !reason && (controller?.canCenter(ready.mount, ready.configuration) ?? false) }
  }

  async function siteView(rig: RigCatalogRecord): Promise<{ site: Site | null, siteUnavailableReason: string | null }> {
    try {
      return { site: mountSite(await adapter(rig).telescopeStatus(mountId(rig))), siteUnavailableReason: null }
    } catch (error) {
      return { site: null, siteUnavailableReason: message(error) }
    }
  }

  function targetView(target: CatalogTarget, site: Site | null, at = now()): TargetView {
    const fov = Math.max(0.5, Math.min(5, (target.majorAxisArcminutes ?? 45) / 60 * 1.8))

    return { id: target.id, name: target.commonName ?? target.catalogName, catalog: target.catalogName, kind: target.type,
      raDegrees: target.raDegrees, decDegrees: target.decDegrees, sizeArcminutes: target.majorAxisArcminutes,
      thumbnailUrl: `/api/survey/thumbnail?ra=${target.raDegrees}&dec=${target.decDegrees}&fov=${fov}`,
      sky: site ? skyPath(target, site, at) : null }
  }

  registerTargetDiscovery(app, catalog, { now, siteView, targetView })

  app.get<{ Params: { rigId: string }, Querystring: { q?: string, offset?: string } }>('/api/web/rigs/:rigId/targets', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)

    if (!rig) return reply.code(404).send({ error: 'Rig not found' })

    if ((request.query.q !== undefined && typeof request.query.q !== 'string')
      || (request.query.offset !== undefined && typeof request.query.offset !== 'string')) return reply.code(400).send({ error: 'Invalid target search' })
    const query = request.query.q ?? ''
    const offset = Number(request.query.offset ?? 0)

    if (query.length > 100 || !Number.isInteger(offset) || offset < 0 || offset > 15000) return reply.code(400).send({ error: 'Invalid target search' })
    const key = normalizeCatalogName(query)

    const matches = key ? listTargets().filter(target => [...target.aliases, target.type].some(value => normalizeCatalogName(value).includes(key)))
      : ['ngc6205', 'ngc6888', 'ngc0224', 'ngc7000', 'ic1805', 'ic1848', 'ngc2024', 'b033', 'ngc1976', 'ngc6992', 'ngc7293', 'ngc0869'].flatMap(id => getTarget(id) ?? [])

    const location = await siteView(rig)

    const view: TargetsView = { rigId: rig.id, rigName: rig.name, total: matches.length,
      targets: matches.slice(offset, offset + 24).map(target => targetView(target, location.site)), ...location }

    return view
  })
  app.get<{ Params: { rigId: string, targetId: string } }>('/api/web/rigs/:rigId/targets/:targetId', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)
    const target = getTarget(request.params.targetId)

    if (!rig || !target) return reply.code(404).send({ error: 'Target or rig not found' })

    return targetView(target, (await siteView(rig)).site)
  })
  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/framing', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)

    return rig ? framingView(rig) : reply.code(404).send({ error: 'Rig not found' })
  })
  app.put<{ Params: { rigId: string } }>('/api/rigs/:rigId/framing/settings', async (request, reply) => {
    if (!jsonBody(request, ['focalLengthMm']) || !isNumber(request.body.focalLengthMm, 10, 20000)) return reply.code(400).send({ error: 'Expected focalLengthMm between 10 and 20000.' })
    const release = operations.acquire(request.params.rigId, 'framing-settings')

    if (!release) return reply.code(409).send({ error: 'Another rig operation is in progress.' })

    try {
      if (!await catalog.setFocalLength(request.params.rigId, request.body.focalLengthMm)) return reply.code(404).send({ error: 'Rig not found' })

      return framingView((await catalog.get(request.params.rigId))!)
    } finally { release() }
  })
  app.post<{ Params: { rigId: string, command: string } }>('/api/rigs/:rigId/framing/:command', async (request, reply) => {
    const { rigId, command } = request.params

    if (!['start', 'stop', 'center'].includes(command)) return reply.code(404).send({ error: 'Unknown framing command' })
    const fields = command === 'start' ? ['targetId', 'raDegrees', 'decDegrees', 'exposureSeconds'] : command === 'center' ? ['checkId'] : []

    if (!jsonBody(request, fields)) return reply.code(400).send({ error: 'Invalid framing command body' })
    const body = request.body

    if (command === 'center' && (typeof body.checkId !== 'string' || !body.checkId.trim())) return reply.code(400).send({ error: 'Expected the solved framing check ID.' })

    if (command === 'start' && (typeof body.targetId !== 'string' || !getTarget(body.targetId)
      || !isNumber(body.raDegrees, 0, 360) || body.raDegrees === 360 || !isNumber(body.decDegrees, -90, 90)
      || !isNumber(body.exposureSeconds, 0.1, 60))) return reply.code(400).send({ error: 'Expected a catalog target, J2000 coordinates and 0.1–60 second exposure.' })
    const rig = await catalog.get(rigId)

    if (!rig) return reply.code(404).send({ error: 'Rig not found' })

    if (command === 'stop') {
      await controllers.get(rigId)?.stop()

      return framingView(rig)
    }

    const release = operations.acquire(rigId, 'framing')

    if (!release) return reply.code(409).send({ error: 'Another rig operation is in progress.' })
    let started = false

    try {
      const ready = await readiness(rig)
      let controller = controllers.get(rigId)

      if (!controller) { controller = createFramingController(now); controllers.set(rigId, controller) }

      const previous = controller.snapshot()

      if (command === 'center') {
        if (previous.actual?.checkId !== body.checkId) throw new Error('The framing check has changed. Review the latest check before centering.')

        if (!controller.canCenter(ready.mount, ready.configuration)) throw new Error('A current solved framing check is required before centering.')
      }

      const desired = command === 'center' ? previous.desired! : { raDegrees: body.raDegrees as number, decDegrees: body.decDegrees as number }
      const solver = options.createSolver?.(ready.camera.fieldHeightDegrees) ?? (options.solver ? createAstapSolver({ ...options.solver, fieldHeightDegrees: ready.camera.fieldHeightDegrees }) : undefined)

      if (!solver) throw new Error('Plate solving is not configured on the Vela server.')
      const hardware = options.createHardware?.(rig, ready.telescopeId) ?? configuredHardware(rig, ready.telescopeId, adapter(rig))
      controller.start({ desired, targetId: command === 'center' ? previous.targetId! : body.targetId as string,
        exposureSeconds: command === 'center' ? previous.exposureSeconds : body.exposureSeconds as number,
        configuration: ready.configuration, center: command === 'center' }, hardware, solver, release)
      started = true

      return framingView(rig)
    } catch (error) {
      return reply.code(409).send({ error: message(error) })
    } finally { if (!started) release() }
  })
  app.addHook('onClose', async () => { await Promise.all([...controllers.values()].map(controller => controller.stop())) })
}

function configuredHardware(rig: RigCatalogRecord, telescopeId: string, adapter: AlpacaFraming): FramingHardware {
  const acquisition = createAlpacaAcquisition({ baseUrl: `http://${rig.endpoint.host}:${rig.endpoint.port}` })

  return {
    status: signal => adapter.telescopeStatus(telescopeId, signal),
    tracking: (enabled, signal) => adapter.setTracking(telescopeId, enabled, signal),
    slew: (position, frame, signal) => {
      if (frame !== 'j2000' && frame !== 'topocentric') throw new Error('Unsupported mount coordinate frame')

      return adapter.slew({ telescopeId, rightAscensionDegrees: position.raDegrees, declinationDegrees: position.decDegrees, coordinateSystem: frame }, signal)
    },
    capture: (exposureSeconds, signal) => acquisition.capture({ cameraId: rig.imagingCamera!.uniqueId, expectedCameraName: rig.imagingCamera!.name, exposureSeconds, signal }),
  }
}

function message(error: unknown) { return error instanceof Error ? error.message : 'Framing state is unavailable' }

function isNumber(value: unknown, min: number, max: number): value is number { return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max }

function jsonBody(request: { body: unknown, headers: { 'content-type'?: string | undefined } }, fields: string[]): request is typeof request & { body: Record<string, unknown> } {
  return !!request.headers['content-type']?.startsWith('application/json') && !!request.body && typeof request.body === 'object' && !Array.isArray(request.body)
    && Object.keys(request.body).length === fields.length && Object.keys(request.body).every(key => fields.includes(key))
}
