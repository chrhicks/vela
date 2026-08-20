import type { ConnectionStatus, DeviceSummary } from '@vela/model/device'
import type { DeviceRig } from '../config/devices.js'
import { createAlpacaClient } from './client.js'
import { toDeviceKind } from './device-kind.js'
import type { ConfiguredDevice } from './types/management.js'

export interface AlpacaService {
  devices(): Promise<DeviceSummary[]>
}

export const createAlpacaService = (rig: DeviceRig): AlpacaService => {
  const client = createAlpacaClient(rig)

  async function driverData(device: ConfiguredDevice): Promise<{ info?: string, version?: string }> {
    let driverInfo: string | undefined
    let driverVersion: string | undefined

    try {
      driverInfo = await client.driverInfo(device)
    } catch { 
      // TODO: if this was prod i'd need to know what the failure was.
      // if it was a connection error - the device is now unavailable
      // if it was a code runtime error - capture / log
      // either way 'driverInfo' remains undefined
    }

    try {
      driverVersion = await client.driverVersion(device)
    } catch { 
      // TODO: if this was prod i'd need to know what the failure was.
      // if it was a connection error - the device is now unavailable
      // if it was a code runtime error - capture / log
      // either way 'driverVersion' remains undefined
    }

    const driver: { info?: string, version?: string } = {}

    if (driverInfo !== undefined) {
      driver.info = driverInfo
    }

    if (driverVersion !== undefined) {
      driver.version = driverVersion
    }

    return driver
  }

  async function connectionStatus(device: ConfiguredDevice): Promise<ConnectionStatus> {
    let status: ConnectionStatus
    
    try {
      const connected = await client.connected(device)

      status = connected === true ? 'connected' : 'disconnected'

    } catch {
      // the device is unavailable if we reach here
      // if its an internal runtime error -  need to handle
      // if its an network error - the device is truly unavailable
      status = 'unavailable'
    }

    return status
  }

  async function devices(): Promise<DeviceSummary[]> {
    const summaries: DeviceSummary[] = []

    for (const device of await client.devices()) {
      const driver = await driverData(device)
      const connection = await connectionStatus(device)
      
      summaries.push({
        id: `${rig.id}-${device.UniqueID}`,
        rigId: rig.id,
        kind: toDeviceKind(device.DeviceType),
        name: device.DeviceName,
        driver,
        connection,
        status: { state: 'unknown' }, // TODO: temp. until using camera alpaca client
        updatedAt: new Date().toISOString()
      })
    }

    return summaries
  }

  return {
    devices
  }
}
