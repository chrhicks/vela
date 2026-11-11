import { PillLink } from '../../components/PillLink.tsx'
import { useScene } from '../../stub/useScene.ts'
import { useStubAdvance } from '../../stub/useStubAdvance.ts'
import { DeviceList } from './DeviceList.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { bringUp, bringUpSeconds, type Device } from './stub.ts'

const isReady = (device: Device) => device.state === 'set' || device.state === 'up'

export function BringUpStep() {
  const scene = useScene(['setting', 'set'])
  const devices = bringUp[scene]
  const ready = devices.filter(isReady).length
  const allReady = ready === devices.length

  useStubAdvance(allReady ? undefined : '/launch/bring-up?scene=set', bringUpSeconds)

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
