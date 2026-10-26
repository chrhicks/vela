import { z } from 'zod'
import type { FastifyInstance, FastifyReply } from 'fastify'
import {
  CaptureStoppedError as EquipmentCaptureStoppedError,
  CaptureUncertainError as EquipmentCaptureUncertainError,
  FrameLostError,
  type Acquisition,
  type CameraCooling,
  type DeviceTelemetry,
} from '@vela/equipment'
import type {
  CaptureCoolingBlocker,
  CaptureCoolingView,
  CaptureSubject,
  CaptureView,
  NavigationCapture,
} from '@vela/model/web'
import { frameTypes } from '../imaging/frame-type.js'
import type { RigCatalogRecord } from '../rig/contracts.js'
import type { RigCatalog } from '../rig/catalog.js'
import type { RigOperations } from '../rig/operations.js'
import { confirmedCameraName } from '../rig/imaging-camera.js'
import { inspectRigDetail, type RigDetailOptions } from '../rig/detail.js'
import { haltBodyError, registerHaltRoutes } from '../http/halt-body.js'
import {
  CaptureFrameLostError,
  CaptureStoppedError,
  CaptureUncertainError,
  createCaptureController,
  interruptedReason,
  type CaptureCamera,
} from './controller.js'
import type { FrameRecords } from './frame-records.js'
import { noCaptureRuns, resumeRequest, type CaptureRunRecord, type CaptureRunRequest, type CaptureRunStore } from './run-store.js'
import type { FrameImaging } from '../imaging/frame-imaging.js'
import { createMemorySavedImageStore, type SavedImageStore } from '../saved-images/store.js'
import type { AlertMonitor } from '../alerts/monitor.js'

export interface CaptureSettings {
  rig: RigCatalogRecord
  cameraId: string
  expectedCameraName: string
}

interface CaptureRouteOptions {
  lookupSubject?: (targetId: string) => CaptureSubject | undefined
  savedImages?: SavedImageStore
  frameRecords?: FrameRecords
  /** Where an active run's request and progress are kept, so a restart can report it. */
  runs?: CaptureRunStore
  images?: FrameImaging
  createCamera?: (settings: CaptureSettings) => CaptureCamera
  createAcquisition: (rig: RigCatalogRecord) => Acquisition
  createInspector: RigDetailOptions['createInspector']
  createCooling: (settings: CaptureSettings) => CameraCooling
  /** Watches each run for the alert rules. */
  alerts?: { monitorFor(rig: RigCatalogRecord): Pick<AlertMonitor, 'runStarted' | 'frameCaptured' | 'runEnded' | 'runInterrupted'> }
}

const MAX_FRAME_COUNT = 10_000

export function configuredCamera(
  settings: CaptureSettings,
  acquisition: Pick<Acquisition, 'capture' | 'biasExposureSeconds'>,
): CaptureCamera {
  return {
    ...(acquisition.biasExposureSeconds && {
      biasExposureSeconds: signal => acquisition.biasExposureSeconds!(settings.cameraId, signal),
    }),
    async capture({ exposureSeconds, frameType, signal, onProgress, onReadState, onProvenance }) {
      try {
        return await acquisition.capture({
          cameraId: settings.cameraId,
          expectedCameraName: settings.expectedCameraName,
          exposureSeconds,
          frameType,
          signal,
          onProgress: elapsedSeconds => onProgress({ phase: 'exposing', elapsedSeconds }),
          onReadout: () => onProgress({ phase: 'reading', elapsedSeconds: exposureSeconds }),
          onReadState,
          onProvenance,
        })
      } catch (error) {
        if (error instanceof EquipmentCaptureStoppedError) throw new CaptureStoppedError()

        if (error instanceof EquipmentCaptureUncertainError) throw new CaptureUncertainError(error.message)

        if (error instanceof FrameLostError) throw new CaptureFrameLostError(error.message)
        throw error
      }
    },
  }
}

function interruptionAlert({ completedCount, frameCount }: CaptureRunRecord) {
  const frames = frameCount === null ? `${completedCount} frames` : `${completedCount} of ${frameCount} frames`

  return `Capture was interrupted: ${interruptedReason} (${frames} taken)`
}

function captureCooling(telemetry: DeviceTelemetry | undefined): CaptureCoolingView | null {
  if (telemetry?.kind !== 'camera' || telemetry.cooling === undefined) return null

  let cooling: CaptureCoolingView = {
    state: telemetry.cooling.state,
    canSetTemperature: telemetry.cooling.setpointControl === true,
  }

  if (telemetry.sensorTemperatureC !== undefined) {
    cooling = { ...cooling, sensorTemperatureC: telemetry.sensorTemperatureC }
  }

  if (telemetry.cooling.setpointC !== undefined) {
    cooling = { ...cooling, setpointC: telemetry.cooling.setpointC }
  }

  if (telemetry.cooling.powerPercent !== undefined) {
    cooling = { ...cooling, powerPercent: telemetry.cooling.powerPercent }
  }

  return cooling
}

export function registerCapture(
  app: FastifyInstance,
  catalog: RigCatalog,
  operations: RigOperations,
  {
    lookupSubject,
    createCamera,
    createAcquisition,
    createInspector,
    createCooling,
    alerts,
    savedImages = createMemorySavedImageStore(),
    frameRecords,
    runs = noCaptureRuns,
    images,
  }: CaptureRouteOptions,
) {
  const controllers = new Map<string, ReturnType<typeof createCaptureController>>()
  const cameraFactory = createCamera ?? (settings => configuredCamera(settings, createAcquisition(settings.rig)))

  function controllerFor(rigId: string, rigName: string) {
    let controller = controllers.get(rigId)

    if (!controller) {
      controller = createCaptureController(
        { rigId, rigName },
        Date.now,
        savedImages,
        frameRecords,
        images,
        runs,
      )

      controllers.set(rigId, controller)
    }

    return controller
  }

  /**
   * Marks observed cooling with whatever owns the Rig's commands right now. It
   * mirrors the cooling command, which any current owner refuses.
   */
  function withCoolingBlocker(
    rigId: string,
    observed: CaptureCoolingView | null,
  ): CaptureCoolingView | null {
    if (!observed) return null
    const { blockedBy: _previous, ...cooling } = observed
    const owner = operations.owner(rigId)
    const held = operations.heldReason(rigId)
    let blockedBy: CaptureCoolingBlocker | undefined

    if (held) blockedBy = { kind: 'hold', reason: held }
    else if (owner === 'alignment' || owner === 'autofocus' || owner === 'framing') blockedBy = owner
    else if (owner === 'capture' && controllers.get(rigId)?.active()) blockedBy = 'capture'
    else if (owner) blockedBy = 'rig'

    return blockedBy ? { ...cooling, blockedBy } : cooling
  }

  function cameraSettings(rig: RigCatalogRecord): CaptureSettings | undefined {
    if (rig.imagingCamera) {
      return {
        rig,
        cameraId: rig.imagingCamera.uniqueId,
        expectedCameraName: rig.imagingCamera.name,
      }
    }

    return undefined
  }

  async function rigView(rigId: string): Promise<CaptureView | undefined> {
    const rig = await catalog.get(rigId)

    if (!rig) return undefined
    const savedImageCount = await savedImages.count(rigId).catch(() => null)

    const current = (): CaptureView => ({
      ...(controllers.get(rigId)?.snapshot() ?? {
        rigId,
        rigName: rig.name,
        camera: null,
        enabled: false,
        unavailableReason: null,
        phase: 'idle',
        active: false,
        repeat: true,
        frameType: 'light',
        saveFrames: false,
        completedCount: 0,
        subject: null,
        savedCount: 0,
        integrationSeconds: 0,
        exposureSeconds: 2,
        elapsedSeconds: 0,
        error: null,
        latestImage: null,
        cooling: null,
        captureReadState: 'current',
      }),
      savedImageCount,
    })

    const unavailable = (reason: string): CaptureView => ({
      ...current(),
      rigName: rig.name,
      enabled: false,
      unavailableReason: reason,
    })

    const target = cameraSettings(rig)

    if (!target)
      return unavailable('Choose an imaging camera on Observe before taking an exposure.')

    const detail = await inspectRigDetail(catalog, rigId, { createInspector })

    if (detail.state === 'not-found') return undefined

    if (detail.state === 'conflict')
      return unavailable('Rig identity needs attention before capture.')

    if (detail.state === 'unavailable')
      return unavailable('Camera state is unavailable. Check the Rig connection.')

    const camera = detail.inspections.find(
      device => device.providerDeviceId === target.cameraId && device.kind === 'camera',
    )

    if (!camera) return unavailable('The configured capture camera was not found.')

    const cameraName = confirmedCameraName(rig, camera.name)
    const cameraView = { name: cameraName ?? target.expectedCameraName }

    const cooling = camera.observation?.state === 'interrupted'
      ? null
      : withCoolingBlocker(rigId, captureCooling(camera.telemetry.values))

    const project = (view: CaptureView): CaptureView => ({ ...view, camera: cameraView, cooling })

    if (!cameraName) {
      return project({
        ...unavailable(
          'Camera identity changed or is unavailable. Check the imaging camera configuration.',
        ),
      })
    }

    if (camera.connection !== 'connected')
      return project({ ...unavailable('Connect the camera before taking an exposure.') })
    const owner = operations.owner(rigId)

    if (owner && owner !== 'capture')
      return project({ ...unavailable(operations.heldReason(rigId) ?? 'Another Rig operation is in progress.') })

    if (!controllers.get(rigId)?.active()) {
      if (camera.observation?.commandReady === false)
        return project(unavailable(camera.observation.message ?? 'Fresh camera state is required before capture.'))
      const telemetry = camera.telemetry.values

      if (telemetry?.kind !== 'camera' || telemetry.activity !== 'idle') {
        return project({ ...unavailable('The camera has not confirmed it is idle.') })
      }
    }

    return project({ ...current(), rigName: rig.name, enabled: true, unavailableReason: null })
  }

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/capture', async (request, reply) => {
    const view = await rigView(request.params.rigId)

    return view ?? reply.code(404).send({ error: 'Rig not found' })
  })

  app.post<{ Params: { rigId: string } }>(
    '/api/rigs/:rigId/capture/start',
    async (request, reply) => {
      const parsed = z
        .strictObject({
          exposureSeconds: z.number().min(0.1).max(600),
          repeat: z.boolean().optional(),
          frameCount: z.number().int().min(1).max(MAX_FRAME_COUNT).optional(),
          saveFrames: z.boolean().optional(),
          frameType: z.enum(frameTypes).optional(),
          targetId: z.string().trim().min(1).max(100).optional(),
        })
        .refine(value => value.frameCount === undefined || value.repeat === true)
        .refine(value => value.targetId === undefined || (value.frameType ?? 'light') === 'light')
        .safeParse(request.body)

      if (!request.headers['content-type']?.startsWith('application/json') || !parsed.success) {
        return reply.code(400).send({
          error:
            `Expected exposureSeconds between 0.1 and 600, optional boolean repeat and saveFrames, optional frameType (${frameTypes.join(', ')}; default light), optional targetId (only for light), and optional frameCount (a whole number from 1 to ${MAX_FRAME_COUNT}, only with repeat: true).`,
        })
      }

      const body = parsed.data
      const subject = body.targetId === undefined ? null : lookupSubject?.(body.targetId)

      if (subject === undefined)
        return reply.code(400).send({ error: 'The selected capture subject was not found.' })

      return startRun(request.params.rigId, reply, {
        exposureSeconds: body.exposureSeconds,
        repeat: body.repeat === true,
        ...(body.frameCount !== undefined && { frameCount: body.frameCount }),
        saveFrames: body.saveFrames === true,
        frameType: body.frameType ?? 'light',
        subject,
      })
    },
  )

  // Starts a new run with the interrupted run's settings and what is left of its count. It is an
  // ordinary start: the lease, the camera checks and the alert monitor apply as for any other.
  registerHaltRoutes(app, scope =>
    scope.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/capture/resume', async (request, reply) => {
      if (request.body !== undefined)
        return reply.code(400).send({ error: haltBodyError })

      const interrupted = () => controllers.get(request.params.rigId)?.interrupted()
      const record = interrupted()

      if (!record) return reply.code(409).send({ error: 'There is no interrupted run to resume.' })

      const resumed = resumeRequest(record)

      if (!resumed) return reply.code(409).send({ error: 'The interrupted run had already taken all its frames.' })

      return startRun(request.params.rigId, reply, resumed, () =>
        interrupted() === record ? undefined : 'The interrupted run is no longer waiting to resume.',
      )
    }),
  )

  async function startRun(
    rigId: string,
    reply: FastifyReply,
    run: CaptureRunRequest,
    refuse: () => string | undefined = () => undefined,
  ) {
    const release = operations.acquire(rigId, 'capture')

    if (!release) {
      return reply.code(409).send({
        error: operations.heldReason(rigId) ?? 'Another Rig operation is in progress.',
      })
    }

    let started = false

    try {
      const refusal = refuse()

      if (refusal) return reply.code(409).send({ error: refusal })
      const view = await rigView(rigId)

      if (!view) return reply.code(404).send({ error: 'Rig not found' })

      if (!view.enabled || !view.camera)
        return reply.code(409).send({ error: view.unavailableReason })
      const rig = await catalog.get(view.rigId)
      const target = rig && cameraSettings(rig)

      if (!target)
        return reply.code(409).send({ error: 'Imaging camera selection is unavailable.' })
      const settings = { ...target, expectedCameraName: view.camera.name }
      const controller = controllerFor(view.rigId, view.rigName)
      const watch = alerts?.monitorFor(rig)
      const light = run.frameType === 'light'
      const camera = cameraFactory(settings)

      watch?.runStarted(run.exposureSeconds, light && run.repeat && run.saveFrames)

      const result = await controller
        .start(run.exposureSeconds, camera, view.camera.name, {
          subject: run.subject,
          // A calibration frame has no stars to judge, but still shows the camera is producing.
          onFrame: image => watch?.frameCaptured(light ? image : { capturedAt: image.capturedAt, statistics: null }),
          onSettled() {
            release()
            watch?.runEnded(controller.snapshot().phase === 'failed' ? 'failed' : 'stopped')
          },
          repeat: run.repeat,
          frameCount: run.frameCount,
          saveFrames: run.saveFrames,
          frameType: run.frameType,
        })
        .catch(error => {
          watch?.runEnded('stopped')
          throw error
        })

      started = true

      return {
        ...result,
        savedImageCount: view.savedImageCount,
        // The run now owns the Rig, so cooling is re-marked after it started.
        cooling: withCoolingBlocker(view.rigId, view.cooling),
      }
    } catch (error) {
      return reply
        .code(409)
        .send({ error: error instanceof Error ? error.message : 'Could not start exposure' })
    } finally {
      if (!started) release()
    }
  }

  app.post<{ Params: { rigId: string } }>(
    '/api/rigs/:rigId/capture/cooling',
    async (request, reply) => {
      const parsed = z
        .strictObject({
          coolerOn: z.boolean().optional(),
          setpointC: z.number().finite().gte(-80).lte(50).optional(),
        })
        .refine(value => value.coolerOn !== undefined || value.setpointC !== undefined)
        .safeParse(request.body)

      if (!request.headers['content-type']?.startsWith('application/json') || !parsed.success) {
        return reply.code(400).send({
          error:
            'Expected coolerOn and/or setpointC. Setting a temperature does not turn the cooler on.',
        })
      }

      const release = operations.acquire(request.params.rigId, 'capture')

      if (!release) {
        return reply.code(409).send({
          error: operations.heldReason(request.params.rigId) ?? 'Another Rig operation is in progress.',
        })
      }

      try {
        const view = await rigView(request.params.rigId)

        if (!view) return reply.code(404).send({ error: 'Rig not found' })

        if (!view.camera)
          return reply
            .code(409)
            .send({ error: view.unavailableReason ?? 'Imaging camera is unavailable.' })
        const rig = await catalog.get(view.rigId)
        const target = rig && cameraSettings(rig)

        if (!target)
          return reply.code(409).send({ error: 'Imaging camera selection is unavailable.' })

        const cooling = createCooling(target)
        const identity = { cameraId: target.cameraId, expectedCameraName: view.camera.name }
        let result

        if (parsed.data.coolerOn !== undefined && parsed.data.setpointC !== undefined) {
          result = await cooling.setCooling({
            ...identity,
            coolerOn: parsed.data.coolerOn,
            setpointC: parsed.data.setpointC,
          })
        } else if (parsed.data.coolerOn !== undefined) {
          result = await cooling.setCooling({ ...identity, coolerOn: parsed.data.coolerOn })
        } else {
          result = await cooling.setCooling({ ...identity, setpointC: parsed.data.setpointC! })
        }

        if (result.outcome === 'uncertain') {
          return reply.code(409).send({
            error:
              'The cooler command could not be confirmed. Check camera cooling before assuming it changed.',
          })
        }

        if (result.outcome === 'failed') {
          const status = result.reason === 'device-not-found' ? 404 : 409

          return reply
            .code(status)
            .send({ error: result.message ?? 'The camera did not accept the cooling command.' })
        }

        // The confirmed state is read after this command's own lease ends, so it
        // does not report cooling as blocked by itself.
        release()

        return (
          (await rigView(request.params.rigId)) ?? reply.code(404).send({ error: 'Rig not found' })
        )
      } catch (error) {
        return reply
          .code(409)
          .send({ error: error instanceof Error ? error.message : 'Could not change cooling' })
      } finally {
        release()
      }
    },
  )

  registerHaltRoutes(app, scope =>
    scope.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/capture/stop', async (request, reply) => {
      if (request.body !== undefined)
        return reply.code(400).send({ error: haltBodyError })

      // Stopping an owned operation must remain possible if readiness changed.
      const controller = controllers.get(request.params.rigId)

      if (controller) await controller.stop()
      const view = await rigView(request.params.rigId)

      return view ?? reply.code(404).send({ error: 'Rig not found' })
    }),
  )

  app.get<{ Params: { rigId: string; imageId: string } }>(
    '/api/rigs/:rigId/capture/images/:imageId',
    async (request, reply) => {
      const rig = await catalog.get(request.params.rigId)

      const image = rig
        ? (controllers.get(rig.id)?.image(request.params.imageId) ??
          (await savedImages.file(rig.id, request.params.imageId, 'native')))
        : undefined

      if (!image) return reply.code(404).send({ error: 'Frame no longer available' })

      return reply
        .type('image/png')
        .header('cache-control', 'private, max-age=3600, immutable')
        .send(image)
    },
  )

  app.get<{ Params: { rigId: string; imageId: string } }>(
    '/api/rigs/:rigId/capture/images/:imageId/fit',
    async (request, reply) => {
      const rig = await catalog.get(request.params.rigId)

      const image = rig
        ? (controllers.get(rig.id)?.fitImage(request.params.imageId) ??
          (await savedImages.file(rig.id, request.params.imageId, 'fit')))
        : undefined

      if (!image) return reply.code(404).send({ error: 'Frame no longer available' })

      return reply
        .type('image/png')
        .header('cache-control', 'private, max-age=3600, immutable')
        .send(image)
    },
  )

  app.post<{ Params: { rigId: string; imageId: string } }>(
    '/api/rigs/:rigId/capture/images/:imageId/keep',
    async (request, reply) => {
      if (
        !request.headers['content-type']?.startsWith('application/json') ||
        !z.strictObject({}).safeParse(request.body).success
      ) {
        return reply.code(400).send({ error: 'Expected an empty JSON object' })
      }

      const { rigId, imageId } = request.params

      if (!(await catalog.get(rigId))) return reply.code(404).send({ error: 'Rig not found' })

      try {
        const image = controllers.has(rigId)
          ? await controllers.get(rigId)!.keep(imageId)
          : await savedImages.get(rigId, imageId)

        return (
          image ??
          reply.code(410).send({
            error:
              'This frame is no longer available to save. Keep a more recent image, or enable Save frames before your next run.',
          })
        )
      } catch (error) {
        request.log.error(error, 'Could not retain capture image')

        return reply
          .code(503)
          .send({ error: 'Image could not be saved. Check storage and try again.' })
      }
    },
  )

  // A run that was active when the server went down is shown as interrupted, and a light run
  // is told to the phone. Nothing exposes: only Chris's start or resume does.
  app.addHook('onReady', async () => {
    for (const rig of await catalog.list()) {
      const record = runs.unfinished(rig.id)

      if (!record) continue
      controllerFor(rig.id, rig.name)

      if (record.frameType === 'light')
        void alerts?.monitorFor(rig).runInterrupted(interruptionAlert(record))
    }
  })

  app.addHook('onClose', async () => {
    await Promise.all([...controllers.values()].map(controller => controller.close()))
  })

  return {
    snapshot(rigId: string): NavigationCapture | undefined {
      const view = controllers.get(rigId)?.snapshot()

      if (!view) return undefined

      const {
        rigName,
        phase,
        captureReadState,
        active,
        completedCount,
        elapsedSeconds,
        exposureSeconds,
        error,
      } = view

      return {
        rigId,
        rigName,
        phase,
        captureReadState,
        active,
        completedCount,
        elapsedSeconds,
        exposureSeconds,
        error,
      }
    },
  }
}
