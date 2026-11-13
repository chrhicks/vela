import { useState } from 'react'

import { ActionButton } from '../../components/ActionButton.tsx'
import type { NudgeRate } from '../../../../state/commands.ts'
import { CommandButton } from '../../components/CommandButton.tsx'
import { PressLine, type Pressed } from '../../components/PressLine.tsx'
import type { Answer } from '../../rig/commands.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { Choices } from '../../components/Choices.tsx'
import { Facts } from '../../components/Facts.tsx'
import { Field } from '../../components/Field.tsx'
import { ActionRow, Area } from './Area.tsx'
import { NudgePad } from './NudgePad.tsx'
import { calibrationFirstStep, type CalibrationType, defaults } from './stub.ts'

function TrackingButton({ onAnswer }: { readonly onAnswer: (answer: Answer) => void }) {
  const tracking = useRig(rig => rig.devices.mount.TELESCOPE_TRACK_STATE?.values.TRACK_ON)

  return tracking === true ? (
    <CommandButton request={{ command: 'tracking', on: false }} onAnswer={onAnswer}>
      Tracking off
    </CommandButton>
  ) : (
    <CommandButton request={{ command: 'tracking', on: true }} onAnswer={onAnswer}>
      Tracking on
    </CommandButton>
  )
}

export function MountArea() {
  const runTarget = useRig(rig => rig.run?.object)
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const target = typed ?? runTarget ?? ''
  const [rate, setRate] = useState<NudgeRate>('slow')
  const [pressed, setPressed] = useState<Pressed | undefined>(undefined)
  const answered = (answer: Answer) => setPressed({ answer, at: Date.now() })

  return (
    <Area id="mount">
      <PressLine pressed={pressed} />

      <ActionRow>
        <CommandButton request={{ command: 'home' }} onAnswer={answered}>
          Home
        </CommandButton>
        <CommandButton request={{ command: 'stop' }} alwaysReady onAnswer={answered}>
          Stop
        </CommandButton>
        <TrackingButton onAnswer={answered} />
        <CommandButton request={{ command: 'flipNow' }} onAnswer={answered}>
          Flip now
        </CommandButton>
      </ActionRow>

      <ActionRow>
        <CommandButton request={{ command: 'slewAndCentre', target }} onAnswer={answered}>
          Slew and centre
        </CommandButton>
        <Field name="Target" kind="text" value={target} onChange={setTyped} />
      </ActionRow>

      <NudgePad rate={rate} onRefused={answered} />

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
  const current = useRig(rig => rig.devices.focuser.ABS_FOCUS_POSITION?.values.FOCUS_ABSOLUTE_POSITION)
  const steps = useLink().controls?.focusSteps ?? []
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const position = typed ?? (current === undefined ? '' : String(current))
  const [pressed, setPressed] = useState<Pressed | undefined>(undefined)
  const answered = (answer: Answer) => setPressed({ answer, at: Date.now() })
  const stepsShown = [...steps.map(step => -step).reverse(), ...steps]

  return (
    <Area id="focus">
      <PressLine pressed={pressed} />

      <ActionRow>
        <ActionButton>Run autofocus</ActionButton>
      </ActionRow>

      <ActionRow>
        <CommandButton request={{ command: 'focusTo', position: Number.parseInt(position, 10) }} onAnswer={answered}>
          Move to
        </CommandButton>
        <Field name="Focuser position" kind="number" value={position} onChange={setTyped} />
      </ActionRow>

      <ActionRow label="Step">
        {stepsShown.map(step => (
          <CommandButton key={step} request={{ command: 'focusBy', steps: step }} onAnswer={answered}>
            {step > 0 ? `+${step}` : String(step)}
          </CommandButton>
        ))}
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
