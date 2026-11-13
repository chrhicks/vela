import { PillLink } from '../../components/PillLink.tsx'
import { useRig } from '../../rig/store.ts'
import { DeviceList } from './DeviceList.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { liveBringUp } from './live.ts'
import type { Device } from './stub.ts'

const isReady = (device: Device) => device.state === 'set' || device.state === 'up'

export function BringUpStep() {
  const devices = liveBringUp(useRig(rig => rig))
  const ready = devices.filter(isReady).length
  const allReady = ready === devices.length

  return (
    <LaunchStep
      step={2}
      title="Bring-up"
      facts={[`${ready} of ${devices.length} set`]}
      action={
        <PillLink to="/launch/align" waiting={!allReady}>
          Align
        </PillLink>
      }
    >
      <DeviceList devices={devices} />
    </LaunchStep>
  )
}
