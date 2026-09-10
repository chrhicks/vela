import type { FastifyInstance } from 'fastify'
import { trace, SpanStatusCode } from '@opentelemetry/api'
import { createAlpacaAcquisition, createAlpacaFraming } from '@vela/alpaca'
import type { AlignmentView } from '@vela/model/web'
import { createRigOperations, type RigOperations } from '../rig/operations.js'
import type { RigCatalog } from '../rig/catalog.js'
import { createAlignmentController, type AlignmentSettings } from './controller.js'
import { createAstapSolver } from './solver.js'
import { createPhysicalAlignment } from './physical.js'

export function registerAlignment(app: FastifyInstance, catalog: RigCatalog, settings?: AlignmentSettings, operations: RigOperations = createRigOperations()) {
  let alignment = settings && settings.mode !== 'physical' ? createAlignmentController({
    mode: 'offline', settings,
    hardware: createAlpacaAcquisition({ baseUrl: settings.endpoint }),
    solver: createAstapSolver({ executable: settings.executable, catalogPath: settings.catalogPath, fieldHeightDegrees: settings.fieldHeightDegrees }),
  }) : undefined

  async function rigView(rigId: string): Promise<AlignmentView | undefined> {
    const rig = await catalog.get(rigId)
    if (!rig) return undefined
    const endpoint = `http://${rig.endpoint.host}:${rig.endpoint.port}`
    const configured = !!settings && endpoint === settings.endpoint
      && rig.lastObservedInventory.devices.some(device => device.uniqueId === settings.cameraId && device.kind === 'camera')
      && rig.lastObservedInventory.devices.some(device => device.uniqueId === settings.telescopeId && device.kind === 'telescope')
    const owner = operations.owner(rigId)
    const reason = !configured ? 'Polar alignment is not configured for this Rig.'
      : owner && owner !== 'alignment' ? 'Another Rig operation is in progress.'
      : settings?.mode === 'physical' && rig.imagingCamera?.uniqueId !== settings.cameraId ? 'Select the configured imaging camera on Observe before alignment.'
      : settings?.mode === 'physical' && !rig.focalLengthMm ? 'Set the effective focal length before alignment.' : null
    const empty: AlignmentView = { rigId, rigName: rig.name, enabled: !reason, unavailableReason: reason,
      phase: 'setup', activity: 'idle', active: false, position: 0, solvedPositions: 0,
      exposureSeconds: settings?.exposureSeconds ?? 2, exposureStartedAt: null, measuredAt: null,
      warning: null, error: null, measurement: null }
    const state = alignment?.snapshot()
    return { ...empty, ...(state && (!state.rigId || state.rigId === rigId) ? state : {}),
      rigId, rigName: rig.name, enabled: !reason, unavailableReason: reason,
      ...(settings?.mode === 'physical' ? { mode: 'physical', ...(rig.imagingCamera ? { cameraName: rig.imagingCamera.name } : {}) } : {}) }
  }
  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/alignment', async (request, reply) => {
    const view = await rigView(request.params.rigId)
    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })
  app.post<{ Params: { rigId: string; command: string } }>('/api/rigs/:rigId/alignment/:command', async (request, reply) => trace.getTracer('vela.alignment').startActiveSpan('alignment.command', { attributes: {
    'alignment.command': request.params.command, 'rig.id': request.params.rigId, 'http.request.id': request.id,
  } }, async span => {
    try {
      if (!request.headers['content-type']?.startsWith('application/json') || !request.body || typeof request.body !== 'object'
        || Array.isArray(request.body) || Object.keys(request.body).length > 0) return reply.code(400).send({ error: 'Expected an empty JSON object' })
      const release = request.params.command === 'start' ? operations.acquire(request.params.rigId, 'alignment') : undefined
      if (request.params.command === 'start' && !release) return reply.code(409).send({ error: 'Another Rig operation is in progress' })
      let started = false
      try {
        const view = await rigView(request.params.rigId)
        if (!view) return reply.code(404).send({ error: 'Rig not found' })
        // Stop remains available to the operation's rig even if saved settings
        // change while it is running.
        if ((request.params.command === 'stop' || request.params.command === 'finish') && alignment?.snapshot().rigId === view.rigId) {
          return await alignment.stop(request.params.command === 'finish')
        }
        if (!view.enabled || !settings) return reply.code(409).send({ error: view.unavailableReason })
        if (request.params.command === 'start') {
          if (settings.mode === 'physical') {
            if (alignment?.active()) throw new Error('A measurement is already running')
            const rig = (await catalog.get(view.rigId))!
            const acquisition = createAlpacaAcquisition({ baseUrl: settings.endpoint })
            const physical = createPhysicalAlignment({ cameraId: settings.cameraId, telescopeId: settings.telescopeId,
              cameraName: rig.imagingCamera!.name, focalLengthMm: rig.focalLengthMm! }, acquisition, createAlpacaFraming({ baseUrl: settings.endpoint }))
            alignment = createAlignmentController({
              mode: 'physical', settings, hardware: acquisition, physical,
              createSolver: fieldHeightDegrees => createAstapSolver({ executable: settings.executable, catalogPath: settings.catalogPath, fieldHeightDegrees }),
            })
          }
          if (!alignment) throw new Error('Polar alignment is not configured')
          const result = await alignment.start(view.rigId, view.rigName, release)
          started = true
          return result
        }
        if (request.params.command === 'stop' || request.params.command === 'finish') {
          return reply.code(409).send({ error: 'There is no alignment measurement for this Rig.' })
        }
        return reply.code(404).send({ error: 'Unknown alignment command' })
      } catch (error) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: error instanceof Error ? error.message : 'Alignment command failed' })
        if (error instanceof Error) span.recordException(error)
        return reply.code(409).send({ error: error instanceof Error ? error.message : 'Alignment command failed' })
      } finally {
        if (!started) release?.()
      }
    } finally {
      span.setAttribute('http.response.status_code', reply.statusCode)
      span.end()
    }
  }))
  app.get<{ Params: { rigId: string; imageId: string } }>('/api/rigs/:rigId/alignment/images/:imageId', async (request, reply) => {
    const view = await rigView(request.params.rigId)
    const image = view && alignment?.snapshot().rigId === request.params.rigId ? alignment.image(request.params.imageId) : undefined
    if (!image) return reply.code(404).send({ error: 'Frame no longer available' })
    return reply.type('image/png').header('cache-control', 'private, max-age=3600, immutable').send(image)
  })
  app.addHook('onClose', async () => { await alignment?.stop() })
  return { active: (rigId: string) => alignment?.active() && alignment.snapshot().rigId === rigId }
}

export function alignmentSettings(env: NodeJS.ProcessEnv): AlignmentSettings | undefined {
  if (!env.VELA_ALIGNMENT_ENDPOINT) return undefined
  const endpoint = new URL(env.VELA_ALIGNMENT_ENDPOINT)
  if (endpoint.protocol !== 'http:' || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) throw new Error('Invalid VELA_ALIGNMENT_ENDPOINT')
  if (!env.VELA_ASTAP || !env.VELA_STAR_CATALOG || !env.VELA_ALIGNMENT_CAMERA_ID || !env.VELA_ALIGNMENT_TELESCOPE_ID) throw new Error('Alignment requires solver, catalog and configured device IDs')
  if (env.VELA_ALIGNMENT_MODE !== undefined && !['offline', 'physical'].includes(env.VELA_ALIGNMENT_MODE)) throw new Error('Invalid VELA_ALIGNMENT_MODE')
  return { endpoint: endpoint.origin, cameraId: env.VELA_ALIGNMENT_CAMERA_ID, telescopeId: env.VELA_ALIGNMENT_TELESCOPE_ID,
    ...(env.VELA_ALIGNMENT_MODE === 'physical' ? { mode: 'physical' } : {}),
    executable: env.VELA_ASTAP, catalogPath: env.VELA_STAR_CATALOG, exposureSeconds: 2, fieldHeightDegrees: 3 }
}
