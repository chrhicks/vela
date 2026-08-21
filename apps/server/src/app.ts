import Fastify from 'fastify'
import type { RigView } from '@vela/model/rig'
import type { HomeView } from '@vela/model/web'
import deviceConfig from './config/devices.js'
import { createRigDeviceInventory } from './device/inventory.js'
import { toDeviceSummary } from './web/device.js'

export function buildApp() {
  const app = Fastify({ logger: true })

  app.get('/api/health', async () => ({ status: 'ok' }))

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
