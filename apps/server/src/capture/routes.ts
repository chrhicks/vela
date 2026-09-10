import type { FastifyInstance } from 'fastify'
import { AlpacaCaptureStoppedError, createAlpacaAcquisition } from '@vela/alpaca'
import type { CaptureView, NavigationCapture } from '@vela/model/web'
import type { RigCatalogRecord } from '../rig/contracts.js'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigOperations } from '../rig/operations.js'
import { inspectRigDetail, type RigDetailOptions } from '../rig/detail.js'
import { CaptureStoppedError, createCaptureController, type CaptureCamera } from './controller.js'
import { createMemorySavedImageStore, type SavedImageStore } from '../saved-images/store.js'

export interface CaptureSettings {
  endpoint: string
  cameraId: string
  expectedCameraName: string
}

interface CaptureRouteOptions {
  savedImages?: SavedImageStore
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
  { createCamera = configuredCamera, createInspector, savedImages = createMemorySavedImageStore() }: CaptureRouteOptions = {},
) {
  const controllers = new Map<string, ReturnType<typeof createCaptureController>>()

  function cameraSettings(rig: RigCatalogRecord): CaptureSettings | undefined {
    const endpoint = `http://${rig.endpoint.host}:${rig.endpoint.port}`

    if (rig.imagingCamera) return { endpoint, cameraId: rig.imagingCamera.uniqueId, expectedCameraName: rig.imagingCamera.name }

    return undefined
  }

  async function rigView(rigId: string): Promise<CaptureView | undefined> {
    const rig = await catalog.get(rigId)

    if (!rig) return undefined
    const savedImageCount = await savedImages.count(rigId).catch(() => null)

    const current = (): CaptureView => ({ ...(controllers.get(rigId)?.snapshot() ?? {
      rigId, rigName: rig.name, camera: null, enabled: false, unavailableReason: null,
      phase: 'idle', active: false, repeat: true, saveFrames: false, completedCount: 0, exposureSeconds: 2, elapsedSeconds: 0, error: null, latestImage: null,
    }), savedImageCount })

    const unavailable = (reason: string): CaptureView => ({ ...current(), rigName: rig.name, enabled: false, unavailableReason: reason })
    const target = cameraSettings(rig)

    if (!target) return unavailable('Choose an imaging camera on Observe before taking an exposure.')
    const detail = await inspectRigDetail(catalog, rigId, createInspector ? { createInspector } : {})

    if (detail.state === 'not-found') return undefined

    if (detail.state === 'conflict') return unavailable('Rig identity needs attention before capture.')

    if (detail.state === 'unavailable') return unavailable('Camera state is unavailable. Check the Rig connection.')
    const camera = detail.inspections.find(device => device.providerDeviceId === target.cameraId && device.kind === 'camera')

    if (!camera) return unavailable('The configured capture camera was not found.')
    const cameraView = { name: rig.imagingCamera?.name ?? camera.name?.trim() ?? camera.configuredName }

    if (!camera.name?.trim() || (rig.imagingCamera && camera.name.trim() !== rig.imagingCamera.name)) return { ...unavailable('Camera identity changed or is unavailable. Check the imaging camera configuration.'), camera: cameraView }

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
      || Object.keys(body).some(key => key !== 'exposureSeconds' && key !== 'repeat' && key !== 'saveFrames')
      || ('saveFrames' in body && typeof body.saveFrames !== 'boolean')
      || ('repeat' in body && typeof body.repeat !== 'boolean') || typeof body.exposureSeconds !== 'number'
      || !Number.isFinite(body.exposureSeconds) || body.exposureSeconds < 0.1 || body.exposureSeconds > 600) {
      return reply.code(400).send({ error: 'Expected exposureSeconds between 0.1 and 600 and optional boolean repeat and saveFrames.' })
    }

    const release = operations.acquire(request.params.rigId, 'capture')

    if (!release) return reply.code(409).send({ error: 'Another Rig operation is in progress.' })
    let started = false

    try {
      const view = await rigView(request.params.rigId)

      if (!view) return reply.code(404).send({ error: 'Rig not found' })

      if (!view.enabled || !view.camera) return reply.code(409).send({ error: view.unavailableReason })
      const rig = await catalog.get(view.rigId)
      const target = rig && cameraSettings(rig)

      if (!target) return reply.code(409).send({ error: 'Imaging camera selection is unavailable.' })
      const settings = { ...target, expectedCameraName: view.camera.name }
      let controller = controllers.get(view.rigId)

      if (!controller) {
        controller = createCaptureController({ rigId: view.rigId, rigName: view.rigName }, Date.now, savedImages)
        controllers.set(view.rigId, controller)
      }

      const result = await controller.start(body.exposureSeconds, createCamera(settings), view.camera.name, {
        onSettled: release, repeat: body.repeat === true, saveFrames: body.saveFrames === true,
      })

      started = true

      return { ...result, savedImageCount: view.savedImageCount }
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
    const image = rig ? controllers.get(rig.id)?.image(request.params.imageId) ?? await savedImages.file(rig.id, request.params.imageId, 'native') : undefined

    if (!image) return reply.code(404).send({ error: 'Frame no longer available' })

    return reply.type('image/png').header('cache-control', 'private, max-age=3600, immutable').send(image)
  })

  app.get<{ Params: { rigId: string, imageId: string } }>('/api/rigs/:rigId/capture/images/:imageId/fit', async (request, reply) => {
    const rig = await catalog.get(request.params.rigId)
    const image = rig ? controllers.get(rig.id)?.fitImage(request.params.imageId) ?? await savedImages.file(rig.id, request.params.imageId, 'fit') : undefined

    if (!image) return reply.code(404).send({ error: 'Frame no longer available' })

    return reply.type('image/png').header('cache-control', 'private, max-age=3600, immutable').send(image)
  })

  app.post<{ Params: { rigId: string, imageId: string } }>('/api/rigs/:rigId/capture/images/:imageId/keep', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !isObject(request.body) || Object.keys(request.body).length !== 0) {
      return reply.code(400).send({ error: 'Expected an empty JSON object' })
    }

    const { rigId, imageId } = request.params

    if (!await catalog.get(rigId)) return reply.code(404).send({ error: 'Rig not found' })

    try {
      const image = controllers.has(rigId)
        ? await controllers.get(rigId)!.keep(imageId)
        : await savedImages.get(rigId, imageId)

      return image ?? reply.code(410).send({ error: 'This frame is no longer available to save. Keep a more recent image, or enable Save frames before your next run.' })
    } catch (error) {
      request.log.error(error, 'Could not retain capture image')

      return reply.code(503).send({ error: 'Image could not be saved. Check storage and try again.' })
    }
  })

  app.addHook('onClose', async () => { await Promise.all([...controllers.values()].map(controller => controller.stop())) })

  return {
    snapshot(rigId: string): NavigationCapture | undefined {
      const view = controllers.get(rigId)?.snapshot()

      if (!view) return undefined
      const { rigName, phase, active, completedCount, elapsedSeconds, exposureSeconds, error } = view

      return { rigId, rigName, phase, active, completedCount, elapsedSeconds, exposureSeconds, error }
    },
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
