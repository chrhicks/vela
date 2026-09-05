import type { FastifyInstance } from 'fastify'
import { createAlpacaAcquisition } from '@vela/alpaca'
import type { AlignmentView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import { createAlignmentController, type AlignmentSettings } from './controller.js'
import { createAstapSolver } from './solver.js'

export function registerAlignment(app: FastifyInstance, catalog: RigCatalog, settings?: AlignmentSettings) {
  const alignment = settings ? createAlignmentController(settings,
    createAlpacaAcquisition({ baseUrl: settings.endpoint }),
    createAstapSolver({ executable: settings.executable, catalogPath: settings.catalogPath, fieldHeightDegrees: settings.fieldHeightDegrees })) : undefined

  async function rigView(rigId: string): Promise<AlignmentView | undefined> {
    const rig = await catalog.get(rigId)
    if (!rig) return undefined
    const endpoint = `http://${rig.endpoint.host}:${rig.endpoint.port}`
    const enabled = !!settings && endpoint === settings.endpoint
      && rig.lastObservedInventory.devices.some(device => device.uniqueId === settings.cameraId && device.kind === 'camera')
      && rig.lastObservedInventory.devices.some(device => device.uniqueId === settings.telescopeId && device.kind === 'telescope')
    const state = alignment?.snapshot()
    if (enabled && state) return { ...state, rigId, rigName: rig.name }
    return { rigId, rigName: rig.name, enabled: false, unavailableReason: 'Polar alignment is not configured for this Rig.',
      phase: 'setup', activity: 'idle', active: false, position: 0, solvedPositions: 0,
      exposureSeconds: settings?.exposureSeconds ?? 2, exposureStartedAt: null, measuredAt: null,
      warning: null, error: null, measurement: null }
  }
  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/alignment', async (request, reply) => {
    const view = await rigView(request.params.rigId)
    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })
  app.post<{ Params: { rigId: string; command: string } }>('/api/rigs/:rigId/alignment/:command', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !request.body || typeof request.body !== 'object'
      || Array.isArray(request.body) || Object.keys(request.body).length > 0) return reply.code(400).send({ error: 'Expected an empty JSON object' })
    const view = await rigView(request.params.rigId)
    if (!view) return reply.code(404).send({ error: 'Rig not found' })
    if (!view.enabled || !alignment) return reply.code(409).send({ error: view.unavailableReason })
    try {
      if (request.params.command === 'start') return await alignment.start(view.rigId, view.rigName)
      if (request.params.command === 'stop') return await alignment.stop()
      if (request.params.command === 'finish') return await alignment.stop(true)
      return reply.code(404).send({ error: 'Unknown alignment command' })
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Alignment command failed' })
    }
  })
  app.get<{ Params: { rigId: string; imageId: string } }>('/api/rigs/:rigId/alignment/images/:imageId', async (request, reply) => {
    const view = await rigView(request.params.rigId)
    const image = view?.enabled ? alignment?.image(request.params.imageId) : undefined
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
  return { endpoint: endpoint.origin, cameraId: env.VELA_ALIGNMENT_CAMERA_ID, telescopeId: env.VELA_ALIGNMENT_TELESCOPE_ID,
    executable: env.VELA_ASTAP, catalogPath: env.VELA_STAR_CATALOG, exposureSeconds: 2, fieldHeightDegrees: 3 }
}
