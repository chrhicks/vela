import { Schema } from 'effect'
import type { SwitchControl, SwitchSetResult } from '@vela/equipment'
import { outcomeOf, type CriaConnection } from './connection.js'
import { createCriaEquipment as createRemoteEquipment } from './v5/equipment.js'
import type { CriaEquipmentBinding } from './equipment.js'

export function createCriaSwitchControl(
  connection: CriaConnection,
  bindings: ReadonlyArray<CriaEquipmentBinding>,
): SwitchControl {
  return {
    async set(command): Promise<SwitchSetResult> {
      const selected = bindings.find(device => device.providerDeviceId === command.switchId && device.kind === 'switch')

      if (!selected || command.expectedSwitchName !== undefined && command.expectedSwitchName !== selected.expectedName)
        return { outcome: 'failed', reason: 'device-not-found' }

      const remote = createRemoteEquipment(connection.session(), bindings.map(binding => ({
        deviceId: binding.providerDeviceId, criaDeviceId: binding.id, expectedName: binding.expectedName,
      })))

      const result = await outcomeOf(
        remote.run(command.switchId, { kind: 'switch-set', parameters: { channelId: command.channelId, value: command.value } }),
        command.signal,
      )

      switch (result.kind) {
        case 'confirmed': {
          const held = result.value.values.value

          return Schema.is(Schema.Number)(held) ? { outcome: 'confirmed', value: held } : { outcome: 'confirmed' }
        }

        case 'uncertain': return { outcome: 'uncertain', reason: 'write-outcome-unknown', message: result.message }
        case 'stopped': return { outcome: 'uncertain', reason: 'cancelled' }
        case 'failed': return { outcome: 'failed', reason: 'rejected', message: result.message }
      }
    },
  }
}
