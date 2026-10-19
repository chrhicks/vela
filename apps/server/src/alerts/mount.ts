import type { EquipmentComposition } from '../equipment/composition.js'
import type { RigCatalog } from '../rig/catalog.js'
import type { MountReading } from './rules.js'

/**
 * Reads a Cria rig's mount for the alert rules. Other rigs have no mount readings
 * here, and neither does a rig that has not yet reported exactly one telescope.
 * The rig is looked up on every read because its inventory fills in after the first inspection.
 */
export function mountReaderFor(
  rigId: string,
  catalog: RigCatalog,
  equipment: Pick<EquipmentComposition, 'createFraming' | 'createAcquisition'>,
) {
  return async (signal: AbortSignal): Promise<MountReading | null> => {
    const rig = await catalog.get(rigId)

    if (!rig?.source) return null

    const telescopes = rig.lastObservedInventory.devices.filter(device => device.kind === 'telescope')

    if (telescopes.length !== 1) return null

    const telescopeId = telescopes[0]!.uniqueId

    const [status, pointing] = await Promise.all([
      equipment.createFraming(rig).telescopeStatus(telescopeId, signal, { includePointingSide: true }),
      equipment.createAcquisition(rig).pointing(telescopeId, signal),
    ])

    // The hour angle is only right against a topocentric right ascension.
    const topocentric = status.coordinateSystem === 'topocentric'

    return {
      tracking: status.tracking,
      slewing: status.slewing,
      parked: status.parked,
      rightAscensionHours: topocentric ? status.rightAscensionDegrees / 15 : null,
      siderealTimeHours: pointing.siderealTimeDegrees / 15,
      pierSide: status.pierSide === 'east' || status.pierSide === 'west' ? status.pierSide : null,
    }
  }
}
