import type { RigDetailView } from '@vela/model/web'

/**
 * The rig page's air temperature: one connected observing-conditions device whose reading is not
 * a last-known value. Zero devices, several, or none reporting a temperature is null, never a guess.
 */
export function airTemperatureC(devices: RigDetailView['devices']): number | null {
  const readings = devices.flatMap(device => {
    if (device.kind !== 'observing-conditions' || device.connection !== 'connected') return []

    if (device.observation?.state === 'interrupted') return []

    return 'temperatureC' in device.status && device.status.temperatureC !== undefined
      ? [device.status.temperatureC]
      : []
  })

  return readings.length === 1 ? readings[0]! : null
}
