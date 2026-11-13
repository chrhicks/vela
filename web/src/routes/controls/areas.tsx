import { useState } from 'react'

import { ActionButton } from '../../components/ActionButton.tsx'
import { CommandButton } from '../../components/CommandButton.tsx'
import { useRig } from '../../rig/store.ts'
import { Choices } from '../../components/Choices.tsx'
import { Facts } from '../../components/Facts.tsx'
import { Field } from '../../components/Field.tsx'
import { ActionRow, Area } from './Area.tsx'
import { NudgePad } from './NudgePad.tsx'
import { calibrationFirstStep, type CalibrationType, defaults } from './stub.ts'

function TrackingButton() {
  const tracking = useRig(rig => rig.devices.mount.TELESCOPE_TRACK_STATE?.values.TRACK_ON)

  return tracking === true ? <CommandButton request={{ command: 'tracking', on: false }}>Tracking off</CommandButton> : <CommandButton request={{ command: 'tracking', on: true }}>Tracking on</CommandButton>
}

export function MountArea() {
  const [target, setTarget] = useState(defaults.slewTarget)
  const [rate, setRate] = useState<'slow' | 'fast'>('slow')

  return (
    <Area id="mount">
      <ActionRow>
        <CommandButton request={{ command: 'home' }}>Home</CommandButton>
        <CommandButton request={{ command: 'stop' }} alwaysReady>
          Stop
        </CommandButton>
        <TrackingButton />
        <ActionButton>Flip now</ActionButton>
      </ActionRow>

      <ActionRow>
        <ActionButton>Slew and centre</ActionButton>
        <Field name="Target" kind="text" value={target} onChange={setTarget} />
      </ActionRow>

      <NudgePad />

      <ActionRow label="Rate">
        <Choices
          name="Nudge rate"
          choices={[
            { value: 'slow', label: 'Slow' },
            { value: 'fast', label: 'Fast' },
          ]}
          chosen={rate}
          onChoose={setRate}
        />
      </ActionRow>
    </Area>
  )
}

export function GuidingArea() {
  return (
    <Area id="guiding">
      <ActionRow>
        <ActionButton>Start</ActionButton>
        <ActionButton>Stop</ActionButton>
        <ActionButton>Restart PHD2</ActionButton>
      </ActionRow>

      <ActionRow>
        <ActionButton>Pick new star</ActionButton>
        <ActionButton>Calibrate</ActionButton>
      </ActionRow>
    </Area>
  )
}

export function FocusArea() {
  const [position, setPosition] = useState(defaults.focusPosition)

  return (
    <Area id="focus">
      <ActionRow>
        <ActionButton>Run autofocus</ActionButton>
      </ActionRow>

      <ActionRow>
        <ActionButton>Move to</ActionButton>
        <Field name="Focuser position" kind="number" value={position} onChange={setPosition} />
      </ActionRow>

      <ActionRow label="Step">
        <ActionButton>-50</ActionButton>
        <ActionButton>-10</ActionButton>
        <ActionButton>+10</ActionButton>
        <ActionButton>+50</ActionButton>
      </ActionRow>
    </Area>
  )
}

export function CameraArea() {
  const [exposure, setExposure] = useState(defaults.testFrame)
  const [setpoint, setSetpoint] = useState(defaults.coolerSetpoint)

  return (
    <Area id="camera">
      <ActionRow>
        <ActionButton>Test frame</ActionButton>
        <Field name="Test frame exposure" kind="number" value={exposure} onChange={setExposure} />
      </ActionRow>

      <ActionRow>
        <ActionButton>Cooler off</ActionButton>
        <ActionButton>Set to</ActionButton>
        <Field name="Cooler setpoint" kind="number" value={setpoint} onChange={setSetpoint} />
      </ActionRow>

      <ActionRow>
        <ActionButton>Power cycle</ActionButton>
      </ActionRow>
    </Area>
  )
}

export function DewArea() {
  const [mode, setMode] = useState<'auto' | 'fixed' | 'off'>('auto')
  const [level, setLevel] = useState(defaults.dewLevel)

  return (
    <Area id="dew">
      <ActionRow>
        <Choices
          name="Dew heater"
          choices={[
            { value: 'auto', label: 'Auto' },
            { value: 'fixed', label: 'Fixed' },
            { value: 'off', label: 'Off' },
          ]}
          chosen={mode}
          onChoose={setMode}
        />

        {mode === 'fixed' ? <Field name="Dew heater level" kind="number" value={level} onChange={setLevel} /> : null}
      </ActionRow>
    </Area>
  )
}

export function CalibrationArea() {
  const [type, setType] = useState<CalibrationType>('darks')
  const [frames, setFrames] = useState(defaults.calibrationFrames)

  return (
    <Area id="calibration">
      <ActionRow>
        <Choices
          name="Calibration type"
          choices={[
            { value: 'darks', label: 'Darks' },
            { value: 'flats', label: 'Flats' },
            { value: 'dark-flats', label: 'Dark flats' },
            { value: 'bias', label: 'Bias' },
          ]}
          chosen={type}
          onChoose={setType}
        />
      </ActionRow>

      <ActionRow label="Frames">
        <Field name="Calibration frames" kind="number" value={frames} onChange={setFrames} />
        <Facts items={[calibrationFirstStep[type]]} />
      </ActionRow>

      <ActionRow>
        <ActionButton>Start set</ActionButton>
      </ActionRow>
    </Area>
  )
}

export function SystemArea() {
  const [device, setDevice] = useState(defaults.resetDevice)

  return (
    <Area id="system">
      <ActionRow>
        <ActionButton>Restart rig software</ActionButton>
      </ActionRow>

      <ActionRow>
        <ActionButton>Reset</ActionButton>
        <Field name="Device to reset" kind="text" value={device} onChange={setDevice} />
      </ActionRow>
    </Area>
  )
}
