import { z } from 'zod'
import { EquipmentError, type EquipmentConnector, type EquipmentInspector } from '@vela/equipment'
import { createEquipmentComposition, type EquipmentComposition } from './equipment/composition.js'
import Fastify from 'fastify'
import { AlpacaProviderError, type AlpacaDiscovery } from '@vela/alpaca'
import type { DiscoveryResultView } from '@vela/model/rig'
import type { RigDeviceInventory, RigInventorySource } from './device/inventory.js'
import { createMemoryRigCatalog, type RigCatalog } from './rig/catalog.js'
import type { RigEquipmentSource } from './rig/contracts.js'
import {
  discoverRigs,
  parseDiscoverRigsInput,
  manualDiscoverySchema,
  toObservedRigInventory,
} from './rig/discovery.js'
import {
  createRigConnectionCoordinator,
  type RigConnectionRequestOptions,
} from './rig/connection.js'
import { loadRigDetailView } from './rig/detail.js'
import { loadHomeView } from './rig/home.js'
import { createRigOperations } from './rig/operations.js'
import { registerDewControls } from './rig/dew-control.js'
import { registerMountControls } from './rig/mount-control.js'
import { getTarget } from './targets/catalog/index.js'
import { registerCapture } from './capture/routes.js'
import { registerAlerts, type AlertsOptions } from './alerts/routes.js'
import { focuserReaderFor } from './alerts/focuser.js'
import { mountReaderFor } from './alerts/mount.js'
import { defaultThresholds } from './alerts/thresholds.js'
import { noFrameRecords, type FrameRecords } from './capture/frame-records.js'
import { noCaptureRuns, type CaptureRunStore } from './capture/run-store.js'
import { frameImaging, type FrameImaging } from './imaging/frame-imaging.js'
import { noAutofocusRecords, registerAutofocus, type AutofocusRecords } from './autofocus/routes.js'
import { registerNavigation } from './navigation.js'
import { registerImagingCamera } from './rig/imaging-camera.js'
import { registerAlignment } from './alignment/routes.js'
import type { AlignmentSettings } from './alignment/controller.js'
import { createMemorySavedImageStore, type SavedImageStore } from './saved-images/store.js'
import { registerSavedImages } from './saved-images/routes.js'
import { registerTargets, type TargetOptions } from './targets/routes.js'
import { createSurveyCache, registerSurvey, type SurveyCache } from './targets/survey.js'

interface BuildAppOptions {
  readonly equipment?: EquipmentComposition
  readonly targets?: Omit<TargetOptions, 'createAdapter' | 'createAcquisition' | 'createInspector'>
  readonly surveyCache?: SurveyCache
  readonly savedImages?: SavedImageStore
  readonly frameRecords?: FrameRecords
  readonly autofocusRecords?: AutofocusRecords
  readonly captureRuns?: CaptureRunStore
  readonly images?: FrameImaging
  readonly alignment?: AlignmentSettings
  readonly alerts?: Pick<AlertsOptions, 'thresholds' | 'notifier' | 'now'>
  readonly alpacaDiscovery?: AlpacaDiscovery
  readonly createConnector?: (rig: RigEquipmentSource) => EquipmentConnector
  readonly createInventory?: (rig: RigInventorySource) => RigDeviceInventory
  readonly createInspector?: (rig: RigEquipmentSource) => EquipmentInspector
  readonly now?: () => Date
  readonly rigCatalog?: RigCatalog
}

interface AddRigRequest {
  readonly name: string
  readonly endpoint: {
    readonly host: string
    readonly port: number
  }
}

export function buildApp({
  targets,
  surveyCache,
  images = frameImaging,
  alignment,
  alerts: alertSettings = { thresholds: defaultThresholds, notifier: null },
  equipment = createEquipmentComposition(),
  alpacaDiscovery = equipment.alpacaDiscovery,
  createConnector = equipment.createConnector,
  createInventory = equipment.createInventory,
  createInspector = equipment.createInspector,
  now = () => new Date(),
  rigCatalog = createMemoryRigCatalog(),
  savedImages = createMemorySavedImageStore(),
  frameRecords = noFrameRecords,
  autofocusRecords = noAutofocusRecords,
  captureRuns = noCaptureRuns,
}: BuildAppOptions = {}) {
  const app = Fastify({ logger: true })
  app.addHook('onReady', async () => { equipment.start() })
  app.addHook('onClose', async () => { await equipment.close() })
  const operations = createRigOperations(equipment.holdsOf)

  const mountControls = registerMountControls(app, rigCatalog, operations, {
    createInspector,
    createMountControl: equipment.createMountControl,
  })

  const dewControls = registerDewControls(app, rigCatalog, {
    createInspector,
    createSwitchControl: equipment.createSwitchControl,
  })

  registerAlignment(app, rigCatalog, alignment, operations, undefined, {
    createInspector,
    settingsForRig: equipment.alignmentSettings,
    createAcquisition: equipment.createAcquisition,
    createFraming: equipment.createFraming,
    createAlignmentEndpointAcquisition: equipment.createAlignmentEndpointAcquisition,
  })

  const alerts = registerAlerts(app, rigCatalog, {
    ...alertSettings,
    mountReaderFor: rigId => mountReaderFor(rigId, rigCatalog, equipment),
    focuserReaderFor: rigId => focuserReaderFor(rigId, rigCatalog, equipment),
  })

  const capture = registerCapture(app, rigCatalog, operations, {
    alerts,
    createInspector,
    createAcquisition: equipment.createAcquisition,
    createCooling: settings => equipment.createCooling(settings.rig),
    savedImages,
    frameRecords,
    runs: captureRuns,
    images,
    lookupSubject(targetId) {
      const target = getTarget(targetId)

      return target ? {
        targetId: target.id,
        name: target.commonName ?? target.catalogName,
        catalog: target.catalogName,
      } : undefined
    },
  })

  registerAutofocus(app, rigCatalog, operations, {
    createInspector,
    createAcquisition: equipment.createAcquisition,
    createFocuserAdapter: equipment.createFocuser,
    records: autofocusRecords,
  })
  registerNavigation(app, rigCatalog, capture)
  registerSavedImages(app, rigCatalog, savedImages)
  registerImagingCamera(app, rigCatalog, operations, { createInspector })
  registerTargets(app, rigCatalog, operations, {
    ...targets,
    createInspector,
    createAdapter: equipment.createFraming,
    createAcquisition: equipment.createAcquisition,
    images,
    now,
  })
  registerSurvey(app, surveyCache ?? createSurveyCache())

  const rigConnections = createRigConnectionCoordinator({
    catalog: rigCatalog,
    createConnector,
    createInspector,
    now,
  })

  app.get('/api/health', async () => ({ status: 'ok' }))

  app.post('/api/rigs/discovery', async (request, reply) => {
    const input = parseDiscoverRigsInput(request.body)

    if (input === undefined) {
      return reply.code(400).send({ error: 'invalid-discovery-request' })
    }

    const controller = new AbortController()
    const cancel = () => controller.abort(new Error('Discovery requester disconnected'))
    request.raw.on('aborted', cancel)
    reply.raw.on('close', cancel)

    try {
      const result = await discoverRigs(input, {
        alpaca: alpacaDiscovery,
        catalog: rigCatalog,
        now,
        signal: controller.signal,
      })

      for (const failure of result.failures) {
        request.log.warn(
          {
            err: failure.cause,
            endpoint: failure.view.endpoint,
            reason: failure.view.reason,
          },
          'Rig discovery operation failed',
        )
      }

      const response: DiscoveryResultView = {
        candidates: result.candidates,
        failures: result.failures.map(failure => failure.view),
      }

      return response
    } finally {
      request.raw.removeListener('aborted', cancel)
      reply.raw.removeListener('close', cancel)
    }
  })

  app.post('/api/rigs', async (request, reply) => {
    const input = parseAddRigRequest(request.body)

    if (input === undefined) {
      return reply.code(400).send({ error: 'invalid-rig' })
    }

    let inspection

    try {
      inspection = await alpacaDiscovery.inspect(input.endpoint)
    } catch (error) {
      if (error instanceof AlpacaProviderError) {
        request.log.warn(
          { err: error, endpoint: input.endpoint },
          'Rig inspection failed before addition',
        )

        return reply.code(502).send({ error: 'rig-inspection-failed' })
      }

      throw error
    }

    const inventory = toObservedRigInventory(inspection, now().toISOString())

    if (inventory.devices.length === 0) {
      return reply.code(422).send({ error: 'no-stable-device-id' })
    }

    const result = await rigCatalog.add({
      name: input.name,
      endpoint: input.endpoint,
      inventory,
    })

    switch (result.state) {
      case 'added':
        return reply.code(201).send({ rigId: result.rig.id })
      case 'known':
        return reply.code(409).send({ error: 'rig-already-added', rigId: result.rigId })
      case 'conflict':
        return reply.code(409).send({ error: 'rig-conflict' })
    }
  })

  app.delete<{ Params: { rigId: string } }>('/api/rigs/:rigId', async (request, reply) => {
    const release = operations.acquire(request.params.rigId, 'rig-management')

    if (!release) {
      return reply.code(409).send({
        error: 'rig-operation-in-progress',
        message: operations.heldReason(request.params.rigId),
      })
    }

    try {
      const operation = await rigConnections.forgetRig(request.params.rigId)

      if (operation.state === 'in-progress') {
        return reply.code(409).send({ error: 'rig-operation-in-progress' })
      }

      if (operation.state === 'not-found') {
        return reply.code(404).send({ error: 'rig-not-found' })
      }

      return reply.code(204).send()
    } finally {
      release()
    }
  })

  app.get('/api/web/home', async request =>
    loadHomeView(rigCatalog, {
      createInventory,
      now,
      onConflict(rig) {
        request.log.warn(
          { rigId: rig.id },
          'Known Rig identity conflicts with its current endpoint',
        )
      },
      onUnavailable(rig, cause) {
        request.log.warn({ err: cause, rigId: rig.id }, 'Known Rig is unavailable')
      },
    }),
  )

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId/observe', async (request, reply) => {
    const controller = new AbortController()
    const cancel = () => controller.abort(new Error('Observation requester disconnected'))
    request.raw.on('aborted', cancel)
    reply.raw.on('close', cancel)

    try {
      const result = await rigConnections.loadObservation(request.params.rigId, {
        ...rigConnectionLogging(request),
        signal: controller.signal,
      })

      if (result.state === 'not-found') {
        return reply.code(404).send({ error: 'rig-not-found' })
      }

      return result.view
    } finally {
      request.raw.removeListener('aborted', cancel)
      reply.raw.removeListener('close', cancel)
    }
  })

  app.post<{ Params: { rigId: string } }>(
    '/api/rigs/:rigId/connections',
    async (request, reply) => {
      const release = operations.acquire(request.params.rigId, 'connection')

      if (!release) {
        return reply.code(409).send({
          error: 'rig-operation-in-progress',
          message: operations.heldReason(request.params.rigId),
        })
      }

      const controller = new AbortController()
      const cancel = () => controller.abort(new Error('Connection requester disconnected'))
      request.raw.on('aborted', cancel)
      reply.raw.on('close', cancel)

      try {
        const operation = await rigConnections.connectDevices(request.params.rigId, {
          ...rigConnectionLogging(request),
          signal: controller.signal,
        })

        if (operation.state === 'not-found') {
          return reply.code(404).send({ error: 'rig-not-found' })
        }

        if (operation.state === 'in-progress') {
          return reply.code(409).send({ error: 'rig-operation-in-progress' })
        }

        return operation.result
      } finally {
        release()
        request.raw.removeListener('aborted', cancel)
        reply.raw.removeListener('close', cancel)
      }
    },
  )

  app.post<{ Params: { rigId: string; deviceId: string } }>(
    '/api/rigs/:rigId/devices/:deviceId/recover',
    async (request, reply) => {
      const parsed = recoverDeviceSchema.safeParse(request.body)

      if (!parsed.success) return reply.code(400).send({ error: 'invalid-recover-request' })
      const rig = await rigCatalog.get(request.params.rigId)

      if (!rig) return reply.code(404).send({ error: 'rig-not-found' })
      const result = await equipment.recover(rig, request.params.deviceId, parsed.data.note)

      if (result.outcome === 'confirmed') return result

      return reply.code(409).send({ error: result.busy ? 'device-busy' : 'recovery-failed', reason: result.message })
    },
  )

  app.get<{ Params: { rigId: string } }>('/api/web/rigs/:rigId', async (request, reply) => {
    const controller = new AbortController()
    const cancel = () => controller.abort(new Error('Rig detail requester disconnected'))
    request.raw.on('aborted', cancel)
    reply.raw.on('close', cancel)

    try {
      const result = await loadRigDetailView(rigCatalog, request.params.rigId, {
        createInspector,
        now,
        signal: controller.signal,
        onConflict(rig) {
          request.log.warn(
            { rigId: rig.id },
            'Known Rig identity conflicts with its current endpoint',
          )
        },
        onUnavailable(rig, state, cause) {
          request.log.warn({ err: cause, rigId: rig.id, state }, 'Known Rig detail is unavailable')
        },
      })

      if (result.state === 'not-found') {
        return reply.code(404).send({ error: 'rig-not-found' })
      }

      return dewControls.decorate(await mountControls.decorate(result.view))
    } finally {
      request.raw.removeListener('aborted', cancel)
      reply.raw.removeListener('close', cancel)
    }
  })

  return app
}

function rigConnectionLogging(
  request: Pick<import('fastify').FastifyRequest, 'log'>,
): Pick<RigConnectionRequestOptions, 'onConflict' | 'onProviderResult' | 'onUnavailable'> {
  return {
    onConflict(rig) {
      request.log.warn({ rigId: rig.id }, 'Known Rig identity conflicts before device connection')
    },
    onProviderResult(providerDeviceId, result) {
      if (!(result instanceof EquipmentError) && result.outcome === 'connected') return
      request.log.warn(
        { providerDeviceId, result },
        'Rig device connection did not confirm success',
      )
    },
    onUnavailable(rig, state, cause) {
      request.log.warn(
        { err: cause, rigId: rig.id, state },
        'Known Rig connection state is unavailable',
      )
    },
  }
}

const recoverDeviceSchema = z.strictObject({
  externalRecoveryConfirmed: z.literal(true),
  note: z.string().trim().min(1).max(1000),
})

const addRigRequestSchema = z
  .strictObject({
    name: z.string().trim().min(1),
    endpoint: manualDiscoverySchema.omit({ mode: true }),
  })
  .transform((value, context): AddRigRequest | typeof z.NEVER => {
    const discoveryInput = parseDiscoverRigsInput({ ...value.endpoint, mode: 'manual' })

    if (discoveryInput?.mode !== 'manual') {
      context.addIssue({ code: 'custom', message: 'Invalid Rig endpoint' })

      return z.NEVER
    }

    return { name: value.name, endpoint: discoveryInput.endpoint }
  })

const parseAddRigRequest = addRigRequestSchema.optional().catch(undefined).parse
