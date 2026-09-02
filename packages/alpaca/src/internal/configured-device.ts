import { AlpacaProviderError } from '../error.js'
import type { ConfiguredDevice } from './types/management.js'

const configuredDevicesEndpoint = '/management/v1/configureddevices'

export function stableDeviceId(device: ConfiguredDevice): string | undefined {
  const id = device.UniqueID?.trim()
  return id === undefined || id.length === 0 ? undefined : id
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
