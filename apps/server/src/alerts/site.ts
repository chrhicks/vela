import type { Site } from '../astronomy/coordinates.js'
import type { EquipmentComposition } from '../equipment/composition.js'
import type { RigCatalog } from '../rig/catalog.js'

/**
 * Reads where a rig is from its mount, which already reports its latitude and longitude. Null when
 * the rig has no single telescope to ask yet or the mount gave no usable location. The rig is looked
 * up on every read because its inventory fills in after the first inspection.
 */
export function siteReaderFor(
  rigId: string,
  catalog: RigCatalog,
  equipment: Pick<EquipmentComposition, 'createFraming'>,
) {
  return async (signal: AbortSignal): Promise<Site | null> => {
    const rig = await catalog.get(rigId)

    if (!rig) return null

    const telescopes = rig.lastObservedInventory.devices.filter(device => device.kind === 'telescope')

    if (telescopes.length !== 1) return null

    const { latitudeDegrees, longitudeDegrees } = await equipment
      .createFraming(rig)
      .telescopeStatus(telescopes[0]!.uniqueId, signal)

    return usableSite(latitudeDegrees, longitudeDegrees)
  }
}

/**
 * A mount with no location set reports 0 N 0 E in the Gulf of Guinea, which would put the dark
 * window hours off. Nobody observes there, so it counts as unknown.
 */
function usableSite(latitude: number | undefined, longitude: number | undefined): Site | null {
  if (latitude === undefined || longitude === undefined) return null

  if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) return null

  if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) return null

  if (latitude === 0 && longitude === 0) return null

  return { latitudeDegrees: latitude, longitudeDegrees: longitude }
}
