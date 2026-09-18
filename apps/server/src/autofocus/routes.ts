import { z } from 'zod'
import type { FastifyInstance } from 'fastify'
import { AlpacaCaptureStoppedError, createAlpacaAcquisition, createAlpacaFocuser } from '@vela/alpaca'
import type { AutofocusView } from '@vela/model/web'
import type { RigCatalog } from '../rig/catalog.js'
import { inspectRigDetail, type RigDetailOptions } from '../rig/detail.js'
import { createRigOperations, type RigOperations } from '../rig/operations.js'
import { CaptureStoppedError } from '../capture/controller.js'
import { createAutofocusController, type AutofocusCamera, type AutofocusFocuser } from './controller.js'
import { measureAutofocusStars } from '../imaging/statistics.js'
import { DEFAULT_OFFSET_STEPS, DEFAULT_STEP_SIZE } from './walk.js'

interface AutofocusRouteOptions {
  createInspector?: RigDetailOptions['createInspector']
  createCamera?: (settings: { endpoint: string, cameraId: string, expectedCameraName: string }) => AutofocusCamera
  createFocuser?: (settings: { endpoint: string, focuserId: string }) => AutofocusFocuser
  measure?: typeof measureAutofocusStars
}

function configuredCamera(settings: { endpoint: string, cameraId: string, expectedCameraName: string }): AutofocusCamera {
  const acquisition = createAlpacaAcquisition({ baseUrl: settings.endpoint })

  return {
    async capture({ exposureSeconds, signal, onProgress }) {
      try {
        return await acquisition.capture({
          cameraId: settings.cameraId, expectedCameraName: settings.expectedCameraName, exposureSeconds, signal,
          onProgress: elapsedSeconds => onProgress(elapsedSeconds),
        })
      } catch (error) {
        if (error instanceof AlpacaCaptureStoppedError) throw new CaptureStoppedError()
        throw error
      }
    },
  }
}

function configuredFocuser(settings: { endpoint: string, focuserId: string }): AutofocusFocuser {
  const focuser = createAlpacaFocuser({ baseUrl: settings.endpoint })

  return {
    status: signal => focuser.status(settings.focuserId, signal),
    move: (position, window, signal) => focuser.move({
      focuserId: settings.focuserId, position, window, ...(signal ? { signal } : {}),
    }),
    halt: () => focuser.halt(settings.focuserId),
  }
}

export function registerAutofocus(
  app: FastifyInstance,
  catalog: RigCatalog,
  operations: RigOperations,
  { createInspector, createCamera = configuredCamera, createFocuser = configuredFocuser, measure }: AutofocusRouteOptions = {},
) {
  const controllers = new Map<string, ReturnType<typeof createAutofocusController>>()

  async function readiness(rigId: string): Promise<{
    view?: AutofocusView
    devices?: { endpoint: string, cameraId: string, focuserId: string }
  }> {
    const rig = await catalog.get(rigId)

    if (!rig) return {}
    const current = (): AutofocusView => controllers.get(rigId)?.snapshot() ?? {
      rigId, rigName: rig.name, enabled: false, unavailableReason: null, cameraName: null, focuserName: null,
      phase: 'setup', activity: 'idle', active: false, startPosition: null, currentPosition: null, maxStep: null,
      stepSize: DEFAULT_STEP_SIZE, offsetSteps: DEFAULT_OFFSET_STEPS, exposureSeconds: 2, elapsedSeconds: 0,
      exposureStartedAt: null, samples: [], fit: null, restoredStart: false, error: null,
    }

    const unavailable = (reason: string, extras: Partial<AutofocusView> = {}) => ({
      view: { ...current(), rigName: rig.name, enabled: false, unavailableReason: reason, ...extras },
    })

    if (!rig.imagingCamera) return unavailable('Choose an imaging camera on Observe before autofocus.')
    const detail = await inspectRigDetail(catalog, rigId, createInspector ? { createInspector } : {})

    if (detail.state === 'not-found') return {}

    if (detail.state === 'conflict') return unavailable('Rig identity needs attention before autofocus.')

    if (detail.state === 'unavailable') return unavailable('Camera and focuser state is unavailable. Check the Rig connection.')
    const camera = detail.inspections.find(device => device.providerDeviceId === rig.imagingCamera?.uniqueId && device.kind === 'camera')
    const focusers = detail.inspections.filter(device => device.kind === 'focuser')
    const cameraView = { cameraName: rig.imagingCamera.name }

    if (!camera) return unavailable('The configured imaging camera was not found.', cameraView)

    if (!camera.name?.trim() || camera.name.trim() !== rig.imagingCamera.name) {
      return unavailable('Camera identity changed or is unavailable. Check the imaging camera configuration.', cameraView)
    }

    if (focusers.length !== 1) return unavailable('Autofocus needs exactly one focuser on this Rig.', cameraView)
    const focuser = focusers[0]!
    const names = { ...cameraView, focuserName: focuser.name?.trim() || focuser.configuredName }

    if (camera.connection !== 'connected') return unavailable('Connect the camera before autofocus.', names)

    if (focuser.connection !== 'connected') return unavailable('Connect the focuser before autofocus.', names)
    const owner = operations.owner(rigId)

    if (owner && owner !== 'autofocus') return unavailable('Another Rig operation is in progress.', names)

    const snapshot = current()
    const focuserTelemetry = focuser.telemetry.values
    const idlePosition = !snapshot.active && focuserTelemetry?.kind === 'focuser'
      ? focuserTelemetry.position ?? snapshot.currentPosition
      : snapshot.currentPosition
    const idleMaxStep = !snapshot.active && focuserTelemetry?.kind === 'focuser'
      ? focuserTelemetry.maxStep ?? snapshot.maxStep
      : snapshot.maxStep

    if (!snapshot.active) {
      const cameraTelemetry = camera.telemetry.values

      if (cameraTelemetry?.kind !== 'camera' || cameraTelemetry.activity !== 'idle') {
        return unavailable('The camera has not confirmed it is idle.', names)
      }

      if (focuserTelemetry?.kind !== 'focuser' || focuserTelemetry.moving) {
        return unavailable('The focuser has not confirmed it is idle.', names)
      }

      if (focuserTelemetry.position === undefined) {
        return unavailable('The focuser did not report an absolute position.', names)
      }
    }

    return {
      view: {
        ...snapshot, rigName: rig.name, ...names, currentPosition: idlePosition, maxStep: idleMaxStep,
        enabled: true, unavailableReason: null,
      },
      devices: {
        endpoint: `http://${rig.endpoint.host}:${rig.endpoint.port}`,
        cameraId: rig.imagingCamera.uniqueId,
        focuserId: focuser.providerDeviceId,
      },
    }
  }

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/autofocus', async (request, reply) => {
    const { view } = await readiness(request.params.rigId)

    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/autofocus/start', async (request, reply) => {
    const parsed = z.strictObject({
      stepSize: z.number().int().min(1).max(2000).optional(),
      offsetSteps: z.number().int().min(1).max(10).optional(),
      exposureSeconds: z.number().min(0.1).max(30).optional(),
    }).safeParse(request.body)

    if (!request.headers['content-type']?.startsWith('application/json') || !parsed.success) {
      return reply.code(400).send({ error: 'Expected optional integer stepSize, offsetSteps, and exposureSeconds between 0.1 and 30.' })
    }

    const release = operations.acquire(request.params.rigId, 'autofocus')

    if (!release) return reply.code(409).send({ error: 'Another Rig operation is in progress.' })
    let started = false

    try {
      const { view, devices } = await readiness(request.params.rigId)

      if (!view) return reply.code(404).send({ error: 'Rig not found' })

      if (!view.enabled || !devices || !view.cameraName || !view.focuserName) {
        return reply.code(409).send({ error: view.unavailableReason })
      }
      let controller = controllers.get(view.rigId)

      if (!controller) {
        controller = createAutofocusController({
          rigId: view.rigId, rigName: view.rigName, cameraName: view.cameraName, focuserName: view.focuserName,
        }, Date.now, measure ?? measureAutofocusStars)
        controllers.set(view.rigId, controller)
      }

      const result = await controller.start(
        createCamera({ endpoint: devices.endpoint, cameraId: devices.cameraId, expectedCameraName: view.cameraName }),
        createFocuser({ endpoint: devices.endpoint, focuserId: devices.focuserId }),
        {
          ...(parsed.data.stepSize !== undefined ? { stepSize: parsed.data.stepSize } : {}),
          ...(parsed.data.offsetSteps !== undefined ? { offsetSteps: parsed.data.offsetSteps } : {}),
          ...(parsed.data.exposureSeconds !== undefined ? { exposureSeconds: parsed.data.exposureSeconds } : {}),
          onSettled: release,
        },
      )

      started = true

      return result
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : 'Could not start autofocus' })
    } finally {
      if (!started) release()
    }
  })

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/autofocus/stop', async (request, reply) => {
    if (!request.headers['content-type']?.startsWith('application/json') || !z.strictObject({}).safeParse(request.body).success) {
      return reply.code(400).send({ error: 'Expected an empty JSON object' })
    }

    const controller = controllers.get(request.params.rigId)

    if (controller) await controller.stop()
    const { view } = await readiness(request.params.rigId)

    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })

  app.addHook('onClose', async () => { await Promise.all([...controllers.values()].map(controller => controller.stop())) })
}
