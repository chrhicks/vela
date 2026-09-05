import type { FastifyInstance } from 'fastify'
import { AlpacaCaptureStoppedError, createAlpacaAcquisition } from '@vela/alpaca'
import type { CaptureView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigOperations } from '../rig/operations.js'
import { inspectRigDetail, type RigDetailOptions } from '../rig/detail.js'
import { CaptureStoppedError, createCaptureController, type CaptureCamera } from './controller.js'

export interface CaptureSettings {
  endpoint: string
  cameraId: string
  expectedCameraName: string
}

interface CaptureRouteOptions {
  createCamera?: (settings: CaptureSettings) => CaptureCamera
  createInspector?: RigDetailOptions['createInspector']
}

function configuredCamera(settings: CaptureSettings): CaptureCamera {
  const acquisition = createAlpacaAcquisition({ baseUrl: settings.endpoint })
  return {
    async capture({ exposureSeconds, signal, onProgress }) {
      try {
        return await acquisition.capture({ cameraId: settings.cameraId, expectedCameraName: settings.expectedCameraName, exposureSeconds, signal,
          onProgress: elapsedSeconds => onProgress({ phase: 'exposing', elapsedSeconds }),
          onReadout: () => onProgress({ phase: 'reading', elapsedSeconds: exposureSeconds }),
        })
      } catch (error) {
        if (error instanceof AlpacaCaptureStoppedError) throw new CaptureStoppedError()
        throw error
      }
    },
  }
}

export function registerCapture(
  app: FastifyInstance,
  catalog: RigCatalog,
  operations: RigOperations,
  { createCamera = configuredCamera, createInspector }: CaptureRouteOptions = {},
) {
  const controllers = new Map<string, ReturnType<typeof createCaptureController>>()

  async function rigView(rigId: string): Promise<CaptureView | undefined> {
    const rig = await catalog.get(rigId)
    if (!rig) return undefined
    const current = (): CaptureView => controllers.get(rigId)?.snapshot() ?? {
      rigId, rigName: rig.name, camera: null, enabled: false, unavailableReason: null,
      phase: 'idle', active: false, exposureSeconds: 2, elapsedSeconds: 0, error: null, latestImage: null,
    }
    const unavailable = (reason: string): CaptureView => ({ ...current(), rigName: rig.name, enabled: false, unavailableReason: reason })
    if (!rig.imagingCamera) return unavailable('Choose an imaging camera in Rig setup.')
    const detail = await inspectRigDetail(catalog, rigId, createInspector ? { createInspector } : {})
    if (detail.state === 'not-found') return undefined
    if (detail.state === 'conflict') return unavailable('Rig identity needs attention before capture.')
    if (detail.state === 'unavailable') return unavailable('Camera state is unavailable. Check the Rig connection.')
    const camera = detail.inspections.find(device => device.providerDeviceId === rig.imagingCamera!.uniqueId && device.kind === 'camera')
    if (!camera) return unavailable('The configured capture camera was not found.')
    const cameraView = { name: rig.imagingCamera.name }
    if (!camera.name?.trim() || camera.name.trim() !== rig.imagingCamera.name) return { ...unavailable('Camera identity changed or is unavailable. Select the imaging camera again in Rig setup.'), camera: cameraView }
    if (camera.connection !== 'connected') return { ...unavailable('Connect the camera before taking an exposure.'), camera: cameraView }
    const owner = operations.owner(rigId)
    if (owner && owner !== 'capture') return { ...unavailable('Another Rig operation is in progress.'), camera: cameraView }
    if (!controllers.get(rigId)?.active()) {
      const telemetry = camera.telemetry.values
      if (telemetry?.kind !== 'camera' || telemetry.activity !== 'idle') {
        return { ...unavailable('The camera has not confirmed it is idle.'), camera: cameraView }
      }
    }
    return { ...current(), rigName: rig.name, camera: cameraView, enabled: true, unavailableReason: null }
  }

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/capture', async (request, reply) => {
    const view = await rigView(request.params.rigId)
    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/capture/start', async (request, reply) => {
    const body = request.body
    if (!request.headers['content-type']?.startsWith('application/json') || !isObject(body)
      || Object.keys(body).length !== 1 || typeof body.exposureSeconds !== 'number'
      || !Number.isFinite(body.exposureSeconds) || body.exposureSeconds < 0.1 || body.exposureSeconds > 600) {
      return reply.code(400).send({ error: 'Expected exposureSeconds between 0.1 and 600.' })
    }
    const release = operations.acquire(request.params.rigId, 'capture')
    if (!release) return reply.code(409).send({ error: 'Another Rig operation is in progress.' })
    let started = false
    try {
      const view = await rigView(request.params.rigId)
      if (!view) return reply.code(404).send({ error: 'Rig not found' })
      if (!view.enabled || !view.camera) return reply.code(409).send({ error: view.unavailableReason })
      const rig = await catalog.get(view.rigId)
      if (!rig?.imagingCamera) return reply.code(409).send({ error: 'Imaging camera selection is unavailable.' })
      const settings = { endpoint: `http://${rig.endpoint.host}:${rig.endpoint.port}`, cameraId: rig.imagingCamera.uniqueId, expectedCameraName: rig.imagingCamera.name }
      let controller = controllers.get(view.rigId)
      if (!controller) {
        controller = createCaptureController({ rigId: view.rigId, rigName: view.rigName })
        controllers.set(view.rigId, controller)
      }
      const result = await controller.start(body.exposureSeconds, createCamera(settings), view.camera.name, release)
      started = true
      return result
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Could not start exposure' })
    } finally {
      if (!started) release()
    }
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/capture/stop', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !isObject(request.body) || Object.keys(request.body).length !== 0) {
      return reply.code(400).send({ error: 'Expected an empty JSON object' })
    }
    // Stopping an owned operation must remain possible if readiness changed.
    const controller = controllers.get(request.params.rigId)
    if (controller) await controller.stop()
    const view = await rigView(request.params.rigId)
    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })

  app.get<{ Params: { rigId: string, imageId: string } }>('/api/rigs/:rigId/capture/images/:imageId', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)
    const image = rig ? controllers.get(rig.id)?.image(request.params.imageId) : undefined
    if (!image) return reply.code(404).send({ error: 'Frame no longer available' })
    return reply.type('image/png').header('cache-control', 'private, max-age=3600, immutable').send(image)
  })

  app.addHook('onClose', async () => { await Promise.all([...controllers.values()].map(controller => controller.stop())) })
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
