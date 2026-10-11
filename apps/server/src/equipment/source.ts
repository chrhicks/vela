import { EquipmentError } from '@vela/equipment'
import type { RigEquipmentSource } from '../rig/contracts.js'

/** Legacy factories must never become a fallback for an explicitly owned rig. */
export function alpacaEndpoint(rig: RigEquipmentSource): string {
  if (rig.source) {
    throw new EquipmentError('The configured Cria equipment connection is unavailable.', {
      reason: 'invalid-response',
      endpoint: 'equipment-configuration',
    })
  }

  return `http://${rig.endpoint.host}:${rig.endpoint.port}`
}
