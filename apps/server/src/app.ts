import Fastify from 'fastify'
import deviceConfig from './config/devices.js';
import { createAlpacaClient } from './alpaca/index.js';
import type { HomeView } from '@vela/model/web';
import type { RigView } from '@vela/model/rig';
import { createAlpacaService } from './alpaca/service.js';

export function buildApp() {
  const app = Fastify({ logger: true })

  app.get('/api/health', async () => ({ status: 'ok' }))

  app.get('/api/connecttest', async () => {
    const rig = deviceConfig.rigs.find(rig => rig.id === 'askar-fra-400');
    if (!rig) {
      throw new Error('Rig not found');
    }
    const client = createAlpacaClient(rig);
    const devices = await client.devices();
    
    for (const device of devices) {
      const connected = await client.connected(device);
      const description = await client.description(device);
      const deviceState = await client.deviceState(device);
      const driverInfo = await client.driverInfo(device);
      const driverVersion = await client.driverVersion(device);
      const interfaceVersion = await client.interfaceVersion(device);
      const supportedActions = await client.supportedActions(device);

      console.log(JSON.stringify({
        deviceName: device.DeviceName,
        deviceId: device.UniqueID,
        deviceType: device.DeviceType,
        deviceNumber: device.DeviceNumber,
        connected: connected,
        description: description,
        deviceState: deviceState,
        driverInfo: driverInfo,
        driverVersion: driverVersion,
        interfaceVersion: interfaceVersion,
        supportedActions: supportedActions,
      }, null, 2));
    }
    return deviceConfig;
  })

  app.get('/api/web/home', async () => {
    const rigConfigs = deviceConfig.rigs
    const rigs: RigView[] = []
    
    await Promise.all(rigConfigs.map(async (cr) => {
      const alpacaService = createAlpacaService(cr)
      const devices = await alpacaService.devices()
      const lastSeenAt = new Date().toISOString()

      rigs.push({
        id: cr.id,
        name: cr.name,
        reachability: 'reachable',
        lastSeenAt,
        devices,
        capabilities: []
      })
    }))
    
    const homeViewMock: HomeView = {
      rigs,
      refreshedAt: new Date().toISOString()
    }

    return homeViewMock
  })

  return app
}
