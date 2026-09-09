import Fastify from 'fastify'
import {
  AlpacaProviderError,
  createAlpacaDiscovery,
  type AlpacaDiscovery,
} from '@vela/alpaca'
import type { DiscoveryResultView } from '@vela/model/rig'
import {
  createRigDeviceInventory,
  type RigDeviceInventory,
  type RigInventorySource,
} from './device/inventory.js'
import {
  createRigDeviceConnector,
  type RigConnectionSource,
  type RigDeviceConnector,
} from './device/connection.js'
import {
  createRigDeviceInspector,
  type RigDeviceInspector,
  type RigInspectionSource,
} from './device/inspection.js'
import {
  createMemoryRigCatalog,
  type RigCatalog,
} from './rig/catalog.js'
import {
  discoverRigs,
  parseDiscoverRigsInput,
  toObservedRigInventory,
} from './rig/discovery.js'
import {
  createRigConnectionCoordinator,
  type RigConnectionRequestOptions,
} from './rig/connection.js'
import { loadRigDetailView } from './rig/detail.js'
import { loadHomeView } from './rig/home.js'
import { createRigOperations } from './rig/operations.js'
import { registerCapture } from './capture/routes.js'
import { registerNavigation } from './navigation.js'
import { registerImagingCamera } from './rig/imaging-camera.js'
import { registerAlignment } from './alignment/routes.js'
import type { AlignmentSettings } from './alignment/controller.js'
import { createMemorySavedImageStore, type SavedImageStore } from './saved-images/store.js'
import { registerSavedImages } from './saved-images/routes.js'
import { registerTargets, type TargetOptions } from './targets/routes.js'
import { createSurveyCache, registerSurvey, type SurveyCache } from './targets/survey.js'

interface BuildAppOptions {
  readonly targets?: TargetOptions
  readonly surveyCache?: SurveyCache
  readonly savedImages?: SavedImageStore
  readonly alignment?: AlignmentSettings
  readonly alpacaDiscovery?: AlpacaDiscovery
  readonly createConnector?: (rig: RigConnectionSource) => RigDeviceConnector
  readonly createInventory?: (rig: RigInventorySource) => RigDeviceInventory
  readonly createInspector?: (rig: RigInspectionSource) => RigDeviceInspector
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
  alignment,
  alpacaDiscovery = createAlpacaDiscovery(),
  createConnector = createRigDeviceConnector,
  createInventory = createRigDeviceInventory,
  createInspector = createRigDeviceInspector,
  now = () => new Date(),
  rigCatalog = createMemoryRigCatalog(),
  savedImages = createMemorySavedImageStore(),
}: BuildAppOptions = {}) {
  const app = Fastify({ logger: true })
  const operations = createRigOperations()
  registerAlignment(app, rigCatalog, alignment, operations)
  const capture = registerCapture(app, rigCatalog, operations, { createInspector, savedImages })
  registerNavigation(app, rigCatalog, capture)
  registerSavedImages(app, rigCatalog, savedImages)
  registerImagingCamera(app, rigCatalog, operations, { createInspector })
  registerTargets(app, rigCatalog, operations, { ...targets, createInspector, now })
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
        failures: result.failures.map((failure) => failure.view),
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
        request.log.warn({ err: error, endpoint: input.endpoint }, 'Rig inspection failed before addition')
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
    if (!release) return reply.code(409).send({ error: 'rig-operation-in-progress' })
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

  app.get('/api/web/home', async (request) => loadHomeView(rigCatalog, {
    createInventory,
    now,
    onConflict(rig) {
      request.log.warn({ rigId: rig.id }, 'Known Rig identity conflicts with its current endpoint')
    },
    onUnavailable(rig, cause) {
      request.log.warn({ err: cause, rigId: rig.id }, 'Known Rig is unavailable')
    },
  }))

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

  app.post<{ Params: { rigId: string } }>('/api/rigs/:rigId/connections', async (request, reply) => {
    const release = operations.acquire(request.params.rigId, 'connection')
    if (!release) return reply.code(409).send({ error: 'rig-operation-in-progress' })
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
  })

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
          request.log.warn({ rigId: rig.id }, 'Known Rig identity conflicts with its current endpoint')
        },
        onUnavailable(rig, state, cause) {
          request.log.warn({ err: cause, rigId: rig.id, state }, 'Known Rig detail is unavailable')
        },
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

  return app
}

function rigConnectionLogging(
  request: { readonly log: { warn(value: object, message: string): void } },
): Pick<RigConnectionRequestOptions, 'onConflict' | 'onProviderResult' | 'onUnavailable'> {
  return {
    onConflict(rig) {
      request.log.warn({ rigId: rig.id }, 'Known Rig identity conflicts before device connection')
    },
    onProviderResult(providerDeviceId, result) {
      if (!(result instanceof AlpacaProviderError) && result.outcome === 'connected') return
      request.log.warn({ providerDeviceId, result }, 'Rig device connection did not confirm success')
    },
    onUnavailable(rig, state, cause) {
      request.log.warn({ err: cause, rigId: rig.id, state }, 'Known Rig connection state is unavailable')
    },
  }
}

function parseAddRigRequest(value: unknown): AddRigRequest | undefined {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => key !== 'name' && key !== 'endpoint')
    || typeof value.name !== 'string'
    || value.name.trim().length === 0
    || !isRecord(value.endpoint)
  ) {
    return undefined
  }

  const discoveryInput = parseDiscoverRigsInput({
    ...value.endpoint,
    mode: 'manual',
  })
  if (discoveryInput?.mode !== 'manual') return undefined

  return {
    name: value.name.trim(),
    endpoint: discoveryInput.endpoint,
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
