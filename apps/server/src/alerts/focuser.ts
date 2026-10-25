import type { EquipmentComposition } from '../equipment/composition.js'
import type { RigCatalog } from '../rig/catalog.js'

/**
 * Reads the focuser position of a rig with exactly one focuser, so the alert monitor can tell the
 * star counts have a new focus behind them. Null when the rig has no focuser to read yet.
 */
export function focuserReaderFor(
  rigId: string,
  catalog: RigCatalog,
  equipment: Pick<EquipmentComposition, 'createFocuser'>,
) {
  return async (signal: AbortSignal): Promise<number | null> => {
    const rig = await catalog.get(rigId)

    if (!rig) return null

    const focusers = rig.lastObservedInventory.devices.filter(device => device.kind === 'focuser')

    if (focusers.length !== 1) return null

    return (await equipment.createFocuser(rig).status(focusers[0]!.uniqueId, signal)).position
  }
}
