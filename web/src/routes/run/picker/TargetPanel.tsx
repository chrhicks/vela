import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'

import type { CoolerSetting, FilterAnswer } from '../../../../../state/commands.ts'
import { endsBy } from '../../../../../state/ends-by.ts'
import type { RememberedAnswer } from '../../../../../state/remembered.ts'
import type { Survey } from '../../../../../state/survey.ts'
import { ActionLink } from '../../../components/ActionLink.tsx'
import { Caption } from '../../../components/Caption.tsx'
import { Choices } from '../../../components/Choices.tsx'
import { CommandPill } from '../../../components/CommandPill.tsx'
import { Field } from '../../../components/Field.tsx'
import { Picture } from '../../../components/Picture.tsx'
import { Readings } from '../../../components/Readings.tsx'
import { Statement } from '../../../components/Statement.tsx'
import { useLocalNow } from '../../../rig/clock.ts'
import { serviceNow } from '../../../rig/service-clock.ts'
import { useLink, useRig } from '../../../rig/store.ts'
import { targetFacts } from '../../../rig/targets.ts'
import { useAsked } from '../../../rig/use-asked.ts'
import { FramedSky } from './FramedSky.tsx'
import { FullSky } from './FullSky.tsx'
import styles from './TargetPanel.module.css'
import { endsByWords, sizeOf, typeOf, unknown } from './words.ts'

interface TargetPanelProps {
  readonly id: string
  readonly darkUntil: number | undefined
  readonly lastLight: RememberedAnswer['lastLight']
  readonly cameraAngleDegrees: number | null
  readonly survey: Survey | null
  readonly detailSurvey: Survey | null
  readonly refreshed: number
}

type Preset = '60' | '90' | '120'

type ExposureChoice = Preset | 'other'

type Stop = 'said' | 'frames'

interface Choice {
  readonly exposure: ExposureChoice
  readonly otherSeconds: number
  readonly stop: Stop
  readonly frames: number
}

const presetSeconds: Readonly<Record<Preset, number>> = { '60': 60, '90': 90, '120': 120 }

const firstChoice: Choice = { exposure: '60', otherSeconds: 180, stop: 'said', frames: 300 }

const frame = 'Frame 3.4 × 2.3°'

const tickMilliseconds = 30_000

const namesShown = 3

const presetOf = (seconds: number): Preset | undefined => (seconds === 60 ? '60' : seconds === 90 ? '90' : seconds === 120 ? '120' : undefined)

function lastChoice(lastLight: RememberedAnswer['lastLight']): Choice {
  if (lastLight === null) return firstChoice

  const preset = presetOf(lastLight.exposureSeconds)

  return {
    exposure: preset ?? 'other',
    otherSeconds: preset === undefined ? lastLight.exposureSeconds : firstChoice.otherSeconds,
    stop: lastLight.frames === null ? 'said' : 'frames',
    frames: lastLight.frames ?? firstChoice.frames,
  }
}

type Framing = 'catalog' | 'last'

const dayOf = (at: number) => new Date(at).toLocaleDateString([], { month: 'short', day: 'numeric' })

const celsiusWords = (celsius: number) => `${celsius} °C`

const wholeNumber = (typed: string, fallback: number) => {
  const value = Number.parseInt(typed, 10)

  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function TargetPanel({ id, darkUntil, lastLight, cameraAngleDegrees, survey, detailSurvey, refreshed }: TargetPanelProps) {
  const last = lastChoice(lastLight)
  const [framing, setFraming] = useState<Framing>('last')
  const [exposure, setExposure] = useState<ExposureChoice>(last.exposure)
  const [otherSeconds, setOtherSeconds] = useState(String(last.otherSeconds))
  const [stop, setStop] = useState<Stop>(last.stop)
  const [frames, setFrames] = useState(String(last.frames))
  const filterIn = useRig(rig => rig.operations.filter)
  const [filter, setFilter] = useState<FilterAnswer | undefined>(filterIn)
  const [coolerChoice, setCoolerChoice] = useState<CoolerSetting['state']>()
  const offeredCelsius = useLink().controls?.coolerCelsius
  const answer = useAsked(() => targetFacts(id), id, refreshed)
  const now = serviceNow(useLink(), useLocalNow(tickMilliseconds))
  const navigate = useNavigate()
  const [search] = useSearchParams()

  if (answer === undefined) return null

  if (answer.status !== 'found') return <Statement size="instruction">{answer.status === 'unknown' ? 'That target is not in the catalog' : 'Vela did not answer'}</Statement>

  const target = answer.facts
  const exposureSeconds = exposure === 'other' ? wholeNumber(otherSeconds, last.otherSeconds) : presetSeconds[exposure]
  const frameCount = wholeNumber(frames, last.frames)
  const centre = framing === 'last' && target.lastCentre !== null ? { raDegrees: target.lastCentre.raDegrees, decDegrees: target.lastCentre.decDegrees } : undefined
  const offset = framing === 'last' && target.lastCentre !== null ? target.lastCentre : undefined
  const remembered = target.lastCooler
  const rememberedOn = remembered?.setting.state === 'on' ? remembered : undefined
  const coolerCelsius = rememberedOn?.setting.state === 'on' ? rememberedOn.setting.celsius : offeredCelsius
  const coolerWanted = coolerChoice ?? remembered?.setting.state ?? 'on'
  const cooler: CoolerSetting | undefined = coolerWanted === 'off' ? { state: 'off' } : coolerCelsius === undefined ? undefined : { state: 'on', celsius: coolerCelsius }
  const fullOpen = new URLSearchParams(search)
  const fullClosed = new URLSearchParams(search)

  fullOpen.set('full', '')
  fullClosed.delete('full')

  const ends =
    now === undefined
      ? unknown
      : endsByWords(endsBy({ now, exposureSeconds, frames: stop === 'frames' ? frameCount : undefined, line: target.placement?.line, darkUntil }), now)

  return (
    <section className={styles.panel}>
      {detailSurvey === null || !search.has('full') ? null : (
        <FullSky
          coarse={survey}
          detail={detailSurvey}
          name={target.name}
          raDegrees={target.raDegrees}
          decDegrees={target.decDegrees}
          angleDegrees={cameraAngleDegrees ?? 0}
          framing={offset ?? { eastDegrees: 0, northDegrees: 0 }}
          facts={[frame, offset === undefined ? 'Catalog centre' : `As ${dayOf(offset.at)}`]}
          closeTo={`/?${fullClosed}`}
        />
      )}

      <Picture label="Chosen" detail={frame} {...(detailSurvey === null ? {} : { to: `/?${fullOpen}` })}>
        <FramedSky survey={survey} raDegrees={target.raDegrees} decDegrees={target.decDegrees} angleDegrees={cameraAngleDegrees ?? undefined} offset={offset} />
      </Picture>

      {survey === null ? null : <p className={styles.credit}>{survey.credit}</p>}

      <h2 className={styles.name}>{target.name}</h2>

      <Readings
        rows={[
          { label: 'Also', value: [...(target.commonName === null ? [] : [target.commonName]), ...target.otherNames].slice(0, namesShown).join(' · ').toUpperCase() || unknown },
          { label: 'Type', value: typeOf(target.type).toUpperCase() },
          { label: 'In', value: target.constellation?.toUpperCase() ?? unknown },
          { label: 'Size', value: sizeOf(target.sizeArcminutes) },
        ]}
      />

      <div className={styles.settings}>
        {target.lastCentre === null ? null : (
          <div className={styles.setting}>
            <Caption>Framing</Caption>

            <div className={styles.answer}>
              <Choices
                name="Framing"
                choices={[
                  { value: 'last', label: `As ${dayOf(target.lastCentre.at)}` },
                  { value: 'catalog', label: 'Catalog centre' },
                ]}
                chosen={framing}
                onChoose={setFraming}
              />
            </div>
          </div>
        )}

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

        <div className={styles.setting}>
          <Caption>Filter</Caption>

          <div className={styles.answer}>
            <Choices
              name="Filter"
              choices={[
                { value: 'in', label: 'In' },
                { value: 'out', label: 'Out' },
              ]}
              chosen={filter}
              onChoose={setFilter}
            />

            {filter === undefined || filter === filterIn ? null : (
              <span className={styles.typed}>
                <span className={styles.unit}>Swap it first</span>
              </span>
            )}
          </div>
        </div>

        <div className={styles.setting}>
          <Caption>Cooler</Caption>

          <div className={styles.answer}>
            <Choices
              name="Cooler"
              choices={[
                { value: 'on', label: `${coolerCelsius === undefined ? 'On' : celsiusWords(coolerCelsius)}${rememberedOn === undefined ? '' : `, as ${dayOf(rememberedOn.at)}`}` },
                { value: 'off', label: `Off${remembered?.setting.state === 'off' ? `, as ${dayOf(remembered.at)}` : ''}` },
              ]}
              chosen={coolerWanted}
              onChoose={setCoolerChoice}
            />
          </div>
        </div>

        <Readings rows={[{ label: 'Ends by', value: ends }]} />
      </div>

      <div className={styles.start}>
        <CommandPill
          request={{ command: 'startTarget', target: target.id, exposureSeconds, filter: filter ?? 'out', ...(stop === 'frames' ? { frames: frameCount } : {}), ...(centre === undefined ? {} : { centre }), cooler: cooler ?? { state: 'off' } }}
          waiting={filter === undefined || cooler === undefined}
          onCarriedOut={() => navigate('/')}
        >
          Start
        </CommandPill>
      </div>

      <div className={styles.back}>
        <ActionLink to="/?pick">Targets</ActionLink>
      </div>
    </section>
  )
}
