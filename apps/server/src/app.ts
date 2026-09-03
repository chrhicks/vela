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
import { loadRigDetailView } from './rig/detail.js'
import { loadHomeView } from './rig/home.js'

interface BuildAppOptions {
  readonly alpacaDiscovery?: AlpacaDiscovery
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
  alpacaDiscovery = createAlpacaDiscovery(),
  createInventory = createRigDeviceInventory,
  createInspector = createRigDeviceInspector,
  now = () => new Date(),
  rigCatalog = createMemoryRigCatalog(),
}: BuildAppOptions = {}) {
  const app = Fastify({ logger: true })

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
    if (!await rigCatalog.forget(request.params.rigId)) {
      return reply.code(404).send({ error: 'rig-not-found' })
    }
    return reply.code(204).send()
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
