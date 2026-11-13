import { useState } from 'react'

import { ActionLink } from '../../../components/ActionLink.tsx'
import { Caption } from '../../../components/Caption.tsx'
import { Choices } from '../../../components/Choices.tsx'
import { Field } from '../../../components/Field.tsx'
import { Picture } from '../../../components/Picture.tsx'
import { PillLink } from '../../../components/PillLink.tsx'
import { Readings } from '../../../components/Readings.tsx'
import { endsBy } from './ends-by.ts'
import { FramedSky } from './FramedSky.tsx'
import { type Exposure, ready, type Target } from './stub.ts'
import styles from './TargetPanel.module.css'

interface TargetPanelProps {
  readonly target: Target
}

type Stop = 'said' | 'frames'

const wholeNumber = (typed: string, fallback: number) => {
  const value = Number.parseInt(typed, 10)

  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function TargetPanel({ target }: TargetPanelProps) {
  const [exposure, setExposure] = useState<Exposure>(ready.lastUsed.exposure)
  const [otherSeconds, setOtherSeconds] = useState(String(ready.lastUsed.otherSeconds))
  const [stop, setStop] = useState<Stop>('said')
  const [frames, setFrames] = useState(String(ready.lastUsed.frames))

  const exposureSeconds = exposure === 'other' ? wholeNumber(otherSeconds, ready.lastUsed.otherSeconds) : Number(exposure)

  const ends = endsBy({
    now: ready.now,
    dawn: ready.dawn,
    targetUntil: target.until,
    exposureSeconds,
    frames: stop === 'frames' ? wholeNumber(frames, ready.lastUsed.frames) : undefined,
  })

  return (
    <section className={styles.panel}>
      <Picture label="Chosen" detail={ready.frame}>
        <FramedSky seed={target.name.length * 13} />
      </Picture>

      <h2 className={styles.name}>{target.name}</h2>

      <Readings
        rows={[
          { label: 'Also', value: target.also.join(' · ').toUpperCase() },
          { label: 'Type', value: target.type.toUpperCase() },
          { label: 'In', value: target.constellation.toUpperCase() },
          { label: 'Size', value: target.size },
        ]}
      />

      <div className={styles.settings}>
        <div className={styles.setting}>
          <Caption>Exposure</Caption>

          <div className={styles.answer}>
            <Choices
              name="Exposure"
              choices={[
                { value: '60', label: '60 s' },
                { value: '90', label: '90 s' },
                { value: '120', label: '120 s' },
              ]}
              chosen={exposure}
              onChoose={setExposure}
            />

            <span className={styles.typed}>
              <Field
                name="Other exposure, seconds"
                kind="number"
                value={otherSeconds}
                resting={exposure !== 'other'}
                onChange={setOtherSeconds}
                onFocus={() => setExposure('other')}
              />

              <span className={exposure === 'other' ? styles.unit : styles.restingUnit}>s</span>
            </span>
          </div>
        </div>

        <div className={styles.setting}>
          <Caption>Stop</Caption>

          <div className={styles.answer}>
            <Choices
              name="Stop"
              choices={[
                { value: 'said', label: 'When I say' },
                { value: 'frames', label: 'After' },
              ]}
              chosen={stop}
              onChoose={setStop}
            />

            <span className={styles.typed}>
              <Field
                name="Frames"
                kind="number"
                value={frames}
                resting={stop !== 'frames'}
                onChange={setFrames}
                onFocus={() => setStop('frames')}
              />

              <span className={stop === 'frames' ? styles.unit : styles.restingUnit}>frames</span>
            </span>
          </div>
        </div>

        <Readings rows={[{ label: 'Ends by', value: ends }]} />
      </div>

      <div className={styles.start}>
        <PillLink to="/" waiting>Start</PillLink>
      </div>

      <div className={styles.back}>
        <ActionLink to="/?pick">Targets</ActionLink>
      </div>
    </section>
  )
}
