import Fastify from 'fastify'
import { createAlpacaDiscovery, type AlpacaDiscovery } from '@vela/alpaca'
import type { DiscoveryResultView, RigView } from '@vela/model/rig'
import type { HomeView } from '@vela/model/web'
import deviceConfig from './config/devices.js'
import { createRigDeviceInventory } from './device/inventory.js'
import { toDeviceSummary } from './web/device.js'
import { discoverRigs, parseDiscoverRigsInput } from './rig/discovery.js'

export function buildApp(alpacaDiscovery: AlpacaDiscovery = createAlpacaDiscovery()) {
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

  app.get('/api/connecttest', async () => {
    const rig = deviceConfig.rigs.find((candidate) => candidate.id === 'askar-fra-400')
    if (!rig) {
      throw new Error('Rig not found')
    }

    const devices = await createRigDeviceInventory(rig).listDevices()
    console.log(JSON.stringify(devices, null, 2))

    return deviceConfig
  })

  app.get('/api/web/home', async () => {
    const rigs: RigView[] = await Promise.all(
      deviceConfig.rigs.map(async (rig) => {
        const devices = await createRigDeviceInventory(rig).listDevices()
        const lastSeenAt = new Date().toISOString()

        return {
          id: rig.id,
          name: rig.name,
          reachability: 'reachable',
          lastSeenAt,
          devices: devices.map(toDeviceSummary),
          capabilities: [],
        }
      }),
    )

    const homeView: HomeView = {
      rigs,
      refreshedAt: new Date().toISOString(),
    }

    return homeView
  })

  return app
}
