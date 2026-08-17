import Fastify from 'fastify'
import deviceConfig from './devices.js';
import { createAlpacaClient } from './alpaca/index.js';

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

  return app
}
