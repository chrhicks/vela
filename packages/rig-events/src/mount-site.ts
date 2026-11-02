import type { ReadingsOf, State } from './wire.ts'

export interface MountSite {
  latitudeDegrees: number
  longitudeDegrees: number
  elevationMeters?: number
}

const valueOf = (reading: ReadingsOf<'mount'>['latitudeDegrees']) => (reading.status === 'unavailable' ? undefined : reading.value)

/** The site a Cria snapshot's mount reports, or null when it has no mount or no latitude and longitude. */
export function mountSite(state: State): MountSite | null {
  const mount = state.devices.find(device => device.kind === 'mount')

  if (mount?.kind !== 'mount') return null

  const latitudeDegrees = valueOf(mount.readings.latitudeDegrees)
  const longitudeDegrees = valueOf(mount.readings.longitudeDegrees)
  const elevationMeters = valueOf(mount.readings.elevationMeters)

  if (latitudeDegrees === undefined || longitudeDegrees === undefined) return null

  return { latitudeDegrees, longitudeDegrees, ...(elevationMeters !== undefined && { elevationMeters }) }
}
