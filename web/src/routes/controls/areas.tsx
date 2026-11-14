import { useState } from 'react'

import { ActionButton } from '../../components/ActionButton.tsx'
import type { NudgeRate } from '../../../../state/commands.ts'
import { CommandButton } from '../../components/CommandButton.tsx'
import { latestSaid, PressLine, saidOf, type Pressed, type Said } from '../../components/PressLine.tsx'
import type { Answer } from '../../rig/commands.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { autofocusEndWords } from '../../rig/words.ts'
import type { Frame } from '../../../../state/frames.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import styles from './areas.module.css'
import { Choices } from '../../components/Choices.tsx'
import { dewHeaters } from '../../../../state/devices.ts'
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
      <PressLine said={pressed === undefined ? undefined : saidOf(pressed)} />

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
  const filter = useRig(rig => rig.operations.filter)
  const exposures = useLink().controls?.autofocusExposureSeconds
  const [typedExposure, setTypedExposure] = useState<string | undefined>(undefined)
  const exposure = typedExposure ?? (exposures === undefined ? '' : String(exposures[filter ?? 'in']))
  const autofocus = useRig(rig => rig.operations.focus)
  const best = useRig(rig => rig.autofocus.best)
  const autofocusEnd: Said | undefined = autofocus?.status === 'ended' ? { words: autofocusEndWords(autofocus.ending, best, current), troubled: autofocus.ending !== 'done', at: autofocus.endedAt } : undefined

  return (
    <Area id="focus">
      <PressLine said={latestSaid(pressed === undefined ? undefined : saidOf(pressed), autofocusEnd)} />

      <ActionRow>
        <CommandButton request={{ command: 'autofocus', exposureSeconds: Number(exposure) }} onAnswer={answered}>
          Run autofocus
        </CommandButton>
        <Field name="Autofocus exposure, seconds" kind="number" value={exposure} onChange={setTypedExposure} />
      </ActionRow>

      <ActionRow>
        <CommandButton request={{ command: 'focusTo', position: Number.parseInt(position, 10) }} onAnswer={answered}>
          Move to
        </CommandButton>
        <Field name="Focuser position" kind="number" value={position} onChange={setTyped} />
      </ActionRow>

      <ActionRow label="Step">
        {stepsShown.map(step => (
          <CommandButton key={step} request={{ command: 'focusBy', steps: step }} alwaysReady onAnswer={answered}>
            {step > 0 ? `+${step}` : String(step)}
          </CommandButton>
        ))}
      </ActionRow>
    </Area>
  )
}

function testFrameSaid(pressed: Pressed | undefined, frames: ReadonlyArray<Frame>): Said | undefined {
  const done = pressed?.answer.result === 'done' ? pressed.answer.done : undefined

  if (done?.code !== 'test-frame') return undefined

  const frame = [...frames].reverse().find(kept => kept.file.startsWith(`${done.sequence}_`) && kept.measurements !== undefined)
  const measured = frame?.measurements

  if (frame === undefined || measured === undefined) return undefined

  const stars = measured.stars === null ? 'no stars' : `${measured.stars} stars`
  const hfd = measured.hfdPixels === null ? [] : [`HFD ${measured.hfdPixels.toFixed(2)} px`]

  return { words: { happened: 'Test frame', toDo: [stars, ...hfd].join(' · ') }, troubled: false, at: frame.keptAt }
}

export function CameraArea() {
  const offeredExposure = useLink().controls?.testFrameSeconds
  const [typedExposure, setTypedExposure] = useState<string | undefined>(undefined)
  const exposure = typedExposure ?? (offeredExposure === undefined ? '' : String(offeredExposure))
  const runActive = useRig(rig => rig.run?.status === 'capturing')
  const frames = useRig(rig => rig.frames)
  const offered = useLink().controls?.coolerCelsius
  const [typedSetpoint, setTypedSetpoint] = useState<string | undefined>(undefined)
  const setpoint = typedSetpoint ?? (offered === undefined ? '' : String(offered))
  const coolerOn = useRig(rig => rig.devices.primary.CCD_COOLER?.values.COOLER_ON)
  const [pressed, setPressed] = useState<Pressed | undefined>(undefined)
  const answered = (answer: Answer) => setPressed({ answer, at: Date.now() })

  return (
    <Area id="camera">
      <PressLine said={latestSaid(pressed === undefined ? undefined : saidOf(pressed), testFrameSaid(pressed, frames))} />

      <ActionRow>
        <CommandButton request={{ command: 'testFrame', exposureSeconds: Number(exposure) }} disabled={runActive} onAnswer={answered}>
          Test frame
        </CommandButton>
        {runActive ? (
          <>
            <span className={styles.note}>Run active</span>
            <ActionLink to="/">See latest frame</ActionLink>
          </>
        ) : (
          <Field name="Test frame exposure, seconds" kind="number" value={exposure} onChange={setTypedExposure} />
        )}
      </ActionRow>

      <ActionRow>
        {coolerOn === true ? (
          <CommandButton request={{ command: 'coolerOff' }} onAnswer={answered}>
            Cooler off
          </CommandButton>
        ) : null}
        <CommandButton request={{ command: 'coolTo', celsius: Number(setpoint) }} onAnswer={answered}>
          Set to
        </CommandButton>
        <Field name="Cooler setpoint, degrees Celsius" kind="number" value={setpoint} onChange={setTypedSetpoint} />
      </ActionRow>
    </Area>
  )
}

export function DewArea() {
  const controls = useLink().controls
  const heater = useRig(rig => dewHeaters(rig.devices.box).find(found => found.channel === controls?.dewChannel))
  const [typed, setTyped] = useState<string | undefined>(undefined)
  const percent = typed ?? (heater !== undefined && heater.on && !heater.auto ? String(heater.percent) : controls === undefined ? '' : String(controls.dewPercent))
  const [pressed, setPressed] = useState<Pressed | undefined>(undefined)
  const answered = (answer: Answer) => setPressed({ answer, at: Date.now() })

  return (
    <Area id="dew">
      <PressLine said={pressed === undefined ? undefined : saidOf(pressed)} />

      <ActionRow>
        {heater?.auto === true ? null : (
          <CommandButton request={{ command: 'dewAuto' }} onAnswer={answered}>
            Auto
          </CommandButton>
        )}
        {heater?.on === false ? null : (
          <CommandButton request={{ command: 'dewOff' }} onAnswer={answered}>
            Off
          </CommandButton>
        )}
        <CommandButton request={{ command: 'dewFixed', percent: Number(percent) }} onAnswer={answered}>
          Set to
        </CommandButton>
        <Field name="Dew heater level, percent" kind="number" value={percent} onChange={setTyped} />
      </ActionRow>
    </Area>
  )
}

export function CalibrationArea() {
  const [type, setType] = useState<CalibrationType>('darks')
  const controls = useLink().controls
  const lastLight = useRig(rig => (rig.run?.frameType === 'light' ? rig.run.exposureSeconds : undefined))
  const runActive = useRig(rig => rig.run?.status === 'capturing')
  const [typedFrames, setTypedFrames] = useState<string | undefined>(undefined)
  const [typedExposure, setTypedExposure] = useState<string | undefined>(undefined)
  const [typedCelsius, setTypedCelsius] = useState<string | undefined>(undefined)
  const frames = typedFrames ?? (controls === undefined ? '' : String(controls.calibrationFrames))
  const exposure = typedExposure ?? (lastLight === undefined ? '' : String(lastLight))
  const celsius = typedCelsius ?? (controls === undefined ? '' : String(controls.coolerCelsius))
  const [pressed, setPressed] = useState<Pressed | undefined>(undefined)
  const answered = (answer: Answer) => setPressed({ answer, at: Date.now() })

  return (
    <Area id="calibration">
      <PressLine said={pressed === undefined ? undefined : saidOf(pressed)} />

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
        <Field name="Calibration frames" kind="number" value={frames} onChange={setTypedFrames} />
        <Facts items={[calibrationFirstStep[type]]} />
      </ActionRow>

      {type === 'darks' ? (
        <ActionRow label="Exposure">
          <Field name="Dark exposure, seconds" kind="number" value={exposure} onChange={setTypedExposure} />
          <span className={styles.note}>at</span>
          <Field name="Dark temperature, degrees Celsius" kind="number" value={celsius} onChange={setTypedCelsius} />
        </ActionRow>
      ) : null}

      <ActionRow>
        <CommandButton
          request={{ command: 'takeDarks', frames: Number.parseInt(frames, 10), exposureSeconds: Number(exposure), celsius: Number(celsius) }}
          disabled={type !== 'darks' || runActive}
          onAnswer={answered}
        >
          Start set
        </CommandButton>
        {runActive ? <span className={styles.note}>Run active</span> : type === 'darks' ? null : <span className={styles.note}>Not built yet</span>}
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
