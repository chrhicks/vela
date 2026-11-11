import { useState } from 'react'

import { ActionLink } from '../../../components/ActionLink.tsx'
import { Caption } from '../../../components/Caption.tsx'
import { Choices } from '../../../components/Choices.tsx'
import { Field } from '../../../components/Field.tsx'
import { Picture } from '../../../components/Picture.tsx'
import { PillLink } from '../../../components/PillLink.tsx'
import { Readings } from '../../../components/Readings.tsx'
import { endsBy } from './endsBy.ts'
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
                { value: 'other', label: 'Other' },
              ]}
              chosen={exposure}
              onChoose={setExposure}
            />

            {exposure === 'other' ? <Field name="Exposure seconds" kind="number" value={otherSeconds} onChange={setOtherSeconds} /> : null}
          </div>
        </div>

        <div className={styles.setting}>
          <Caption>Stop</Caption>

          <div className={styles.answer}>
            <Choices
              name="Stop"
              choices={[
                { value: 'said', label: 'When I say' },
                { value: 'frames', label: 'After frames' },
              ]}
              chosen={stop}
              onChoose={setStop}
            />

            {stop === 'frames' ? <Field name="Frames" kind="number" value={frames} onChange={setFrames} /> : null}
          </div>
        </div>

        <Readings rows={[{ label: 'Ends by', value: ends }]} />
      </div>

      <div className={styles.start}>
        <PillLink to="/?scene=starting">Start</PillLink>
      </div>

      <div className={styles.back}>
        <ActionLink to="/?scene=ready">Targets</ActionLink>
      </div>
    </section>
  )
}
