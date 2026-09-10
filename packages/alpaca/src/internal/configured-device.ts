import { AlpacaProviderError } from '../error.js'
import type { ConfiguredDevice } from './types/management.js'

const configuredDevicesEndpoint = '/management/v1/configureddevices'

export function normalizeConfiguredDevices(
  devices: ReadonlyArray<ConfiguredDevice>,
): ReadonlyArray<ConfiguredDevice> {
  return devices.map((device) => {
    const name = device.DeviceName.trim()

    if (name.length === 0) {
      throw new AlpacaProviderError(
        'Alpaca returned a configured device without a usable name',
        {
          reason: 'invalid-response',
          endpoint: configuredDevicesEndpoint,
        },
      )
    }

    return name === device.DeviceName ? device : { ...device, DeviceName: name }
  })
}

export function stableDeviceId(device: ConfiguredDevice): string | undefined {
  const id = device.UniqueID?.trim()

  return id === undefined || id.length === 0 ? undefined : id
}

export function rejectMissingDeviceIds(
  devices: ReadonlyArray<ConfiguredDevice>,
): void {
  if (devices.some((device) => stableDeviceId(device) === undefined)) {
    throw new AlpacaProviderError(
      'Alpaca returned a configured device without a stable UniqueID',
      {
        reason: 'invalid-response',
        endpoint: configuredDevicesEndpoint,
      },
    )
  }
}

export function rejectDuplicateDeviceIds(
  devices: ReadonlyArray<ConfiguredDevice>,
): void {
  const seen = new Set<string>()

  for (const device of devices) {
    const id = stableDeviceId(device)

    if (id === undefined) continue

    if (seen.has(id)) {
      throw new AlpacaProviderError(
        `Alpaca returned duplicate device UniqueID ${id}`,
        {
          reason: 'invalid-response',
          endpoint: configuredDevicesEndpoint,
        },
      )
    }

    seen.add(id)
  }
}
