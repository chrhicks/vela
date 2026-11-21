import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

import type { HorizonNight } from '../../../../state/horizon-night.ts'
import type { Layer } from '../../../../state/horizon-layers.ts'
import { sliderSettings } from '../../../../state/horizon-slider.ts'
import { backTo, clockIn, fractionOf, inSpan, laneRuns, nightSpan, readoutAt, readoutSentence, steppedBy, timeAtFraction, trackHours, zoneName, type TimeRun } from '../../../../state/horizon-view.ts'
import { ActionButton } from '../../components/ActionButton.tsx'
import styles from './HorizonSlider.module.css'

interface HorizonSliderProps {
  readonly night: HorizonNight
  readonly now: number | undefined
  readonly selected: number
  readonly layers: ReadonlySet<Layer>
  readonly onSelect: (at: number) => void
}

const percent = (fraction: number) => `${(fraction * 100).toFixed(3)}%`

const barStyle = (span: TimeRun, run: TimeRun) => ({ left: percent(fractionOf(span, run.from)), width: percent(fractionOf(span, run.until) - fractionOf(span, run.from)) })

export function HorizonSlider({ night, now, selected, layers, onSelect }: HorizonSliderProps) {
  const [playing, setPlaying] = useState(false)
  const field = useRef<HTMLDivElement>(null)
  const latest = useRef(selected)
  latest.current = selected

  const span = nightSpan(night)
  const clock = clockIn(night.zone)
  const readout = readoutAt(night, selected)
  const lanes = laneRuns(night)
  const hours = trackHours(span, night.zone)
  const back = backTo(night, now)
  const moonLane = layers.has('moon')
  const nowHere = now !== undefined && inSpan(span, now)
  const { stepMinutes, bigStepMinutes, playMinutesPerSecond, playFrameMilliseconds } = sliderSettings

  useEffect(() => {
    if (!playing) return

    let last = performance.now()

    const timer = window.setInterval(() => {
      const moment = performance.now()
      const next = steppedBy(span, latest.current, ((moment - last) / 1000) * playMinutesPerSecond)

      last = moment
      onSelect(next)

      if (next >= span.until) setPlaying(false)
    }, playFrameMilliseconds)

    return () => window.clearInterval(timer)
  }, [playing, span.from, span.until, playMinutesPerSecond, playFrameMilliseconds])

  const choose = (at: number) => {
    setPlaying(false)
    onSelect(at)
  }

  const toggle = () => {
    if (playing) return setPlaying(false)

    if (selected >= span.until) onSelect(span.from)

    setPlaying(true)
  }

  const reach = (event: PointerEvent<HTMLDivElement>) => {
    const box = field.current?.getBoundingClientRect()

    if (box !== undefined && box.width > 0) choose(timeAtFraction(span, (event.clientX - box.left) / box.width))
  }

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const minutes = event.shiftKey ? bigStepMinutes : stepMinutes

    const target =
      event.key === 'ArrowRight' || event.key === 'ArrowUp'
        ? steppedBy(span, selected, minutes)
        : event.key === 'ArrowLeft' || event.key === 'ArrowDown'
          ? steppedBy(span, selected, -minutes)
          : event.key === 'PageUp'
            ? steppedBy(span, selected, bigStepMinutes)
            : event.key === 'PageDown'
              ? steppedBy(span, selected, -bigStepMinutes)
              : event.key === 'Home'
                ? span.from
                : event.key === 'End'
                  ? span.until
                  : undefined

    if (target === undefined) return

    event.preventDefault()
    choose(target)
  }

  return (
    <section className={styles.slider} aria-label="Time in the night">
      <div className={styles.head}>
        <button type="button" className={styles.play} aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {playing ? <path d="M8 6h3v12H8zM13 6h3v12h-3z" /> : <path d="M9 6l9 6-9 6z" />}
          </svg>
        </button>

        <output className={styles.readout}>{`${clock(selected)} ${zoneName(night.zone, selected)}`}</output>

        <span className={`${styles.words} ${readout.clear ? styles.clear : ''}`}>{`${readout.altitude} · ${readout.verdict}`}</span>

        <span className={styles.hint}>{`Drag, or ← → for ${stepMinutes} min, shift for ${bigStepMinutes / 60} h`}</span>

        <span className={styles.back}>
          <ActionButton quiet onPress={() => choose(back.at)}>
            {back.toNow ? 'Back to now' : night.times.darkAt === null ? 'To dusk' : 'To dark'}
          </ActionButton>
        </span>
      </div>

      <div className={styles.body}>
        <div className={styles.labels} aria-hidden="true">
          <span className={styles.trackLabel} />
          <span className={styles.laneLabel}>Dark</span>
          <span className={styles.laneLabel}>{`${night.target.name} clear`}</span>
          {moonLane ? <span className={styles.laneLabel}>Moon up</span> : null}
        </div>

        <div
          ref={field}
          className={styles.field}
          role="slider"
          tabIndex={0}
          aria-label="Time in the night"
          aria-orientation="horizontal"
          aria-valuemin={span.from}
          aria-valuemax={span.until}
          aria-valuenow={Math.round(selected)}
          aria-valuetext={readoutSentence(night, selected, clock)}
          onKeyDown={key}
          onPointerDown={event => {
            event.currentTarget.setPointerCapture(event.pointerId)
            reach(event)
          }}
          onPointerMove={event => {
            if (event.currentTarget.hasPointerCapture(event.pointerId)) reach(event)
          }}
        >
          <div className={styles.track}>
            <span className={styles.line} />

            {hours.map(hour => (
              <span key={hour.at} className={styles.hour} style={{ left: percent(fractionOf(span, hour.at)) }}>
                <span className={styles.hourLabel}>{hour.label}</span>
                <span className={styles.hourTick} />
              </span>
            ))}

            {nowHere ? (
              <span className={styles.now} style={{ left: percent(fractionOf(span, now)) }}>
                <span className={styles.nowDot} />
                <span className={styles.nowLabel}>Now</span>
              </span>
            ) : null}
          </div>

          <div className={styles.lane}>
            {lanes.dark.map(run => (
              <span key={run.from} className={`${styles.bar} ${styles.darkBar}`} style={barStyle(span, run)} />
            ))}
          </div>

          <div className={styles.lane}>
            {lanes.clear.map(run => (
              <span key={run.from} className={`${styles.bar} ${styles.clearBar}`} style={barStyle(span, run)} />
            ))}
          </div>

          {moonLane ? (
            <div className={styles.lane}>
              {lanes.moon.map(run => (
                <span key={run.from} className={`${styles.bar} ${styles.moonBar}`} style={barStyle(span, run)} />
              ))}
            </div>
          ) : null}

          <span className={styles.cursor} style={{ left: percent(fractionOf(span, selected)) }}>
            <span className={styles.thumb} />
          </span>
        </div>
      </div>
    </section>
  )
}
