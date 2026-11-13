import { flip } from '../../../../state/flip.ts'
import type { Frame } from '../../../../state/frames.ts'
import type { Guiding } from '../../../../state/guiding.ts'
import { dewHeaters, focusPosition, mountActivity, sensorCelsius, type Devices } from '../../../../state/devices.ts'
import type { Run } from '../../../../state/run.ts'
import type { Span } from '../../components/Chart.tsx'
import type { Reading } from '../../components/Readings.tsx'
import { niceTicks } from '../../components/ticks.ts'
import type { Point, Trends } from '../../../../state/trends.ts'
import type { TrendWindowName } from './TrendWindow.tsx'
import type { Capturing, Trend, TrendView } from './stub.ts'
import { flipWord, guidingWord, mountWords, unknown } from '../../rig/words.ts'

const clock = (at: number, withSeconds = false) =>
  new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', ...(withSeconds ? { second: '2-digit' } : {}), hour12: false })

const fixed = (value: number | null, digits: number, unit = '') => (value === null ? unknown : `${value.toFixed(digits)}${unit}`)

const latestMeasured = (frames: ReadonlyArray<Frame>) => [...frames].reverse().find(frame => frame.measurements !== undefined)

function latestStats(frame: Frame | undefined): ReadonlyArray<Reading> {
  const measured = frame?.measurements

  return [
    { label: 'HFD', value: measured === undefined ? unknown : fixed(measured.hfdPixels, 2, ' px') },
    { label: 'Stars', value: measured === undefined ? unknown : fixed(measured.stars, 0) },
    { label: 'Sky', value: measured === undefined ? unknown : fixed(measured.sky, 0) },
    { label: 'Noise', value: measured === undefined ? unknown : fixed(measured.noise, 1) },
    { label: 'Off centre', value: unknown },
    { label: 'Vs baseline', value: unknown },
  ]
}

function rigLine(devices: Devices, guiding: Guiding, now: number | undefined): ReadonlyArray<Reading> {
  const activity = mountActivity(devices.mount)
  const sensor = sensorCelsius(devices.primary)
  const focus = focusPosition(devices.focuser)
  const heaters = dewHeaters(devices.box)

  return [
    { label: 'Mount', value: activity === undefined ? unknown : mountWords[activity] },
    { label: 'Guiding', value: guidingWord(guiding) },
    { label: 'Sensor', value: sensor === undefined ? unknown : `${sensor.toFixed(1)} °C` },
    { label: 'Focus', value: focus === undefined ? unknown : `${focus}` },
    { label: 'Dew', value: heaters.length === 0 ? unknown : `${heaters.map(heater => heater.percent.toFixed(0)).join(' / ')} %` },
    { label: 'Flip', value: flipWord(flip(devices.mount, now)) },
  ]
}

const hour = 3_600_000

const lastY = (line: ReadonlyArray<Point>) => line.at(-1)?.y

const shownWith = (digits: number) => (line: ReadonlyArray<Point>) => {
  const y = lastY(line)

  return y === undefined ? unknown : y.toFixed(digits)
}

function shownValues(line: ReadonlyArray<Point>, span: Span, held: boolean): ReadonlyArray<number> {
  const inside = line.filter(point => point.x >= span.from && point.x <= span.to).map(point => point.y)
  const carriedIn = held ? line.filter(point => point.x < span.from).at(-1)?.y : undefined

  return carriedIn === undefined ? inside : [carriedIn, ...inside]
}

function chart(title: string, lines: ReadonlyArray<ReadonlyArray<Point>>, current: string, span: Span, onPhone: boolean, held = false): Trend {
  const seen = lines.flatMap(line => shownValues(line, span, held))

  return { onPhone, chart: { title, current, lines, yTicks: niceTicks(seen), span, held } }
}

function trendView(trends: Trends, span: Span): TrendView {
  const dewChannels = Object.keys(trends.dewHeaters).sort()
  const dewLines = dewChannels.map(channel => trends.dewHeaters[channel] ?? [])
  const twoDigits = shownWith(2)
  const oneDigit = shownWith(1)
  const whole = shownWith(0)

  return {
    span: [clock(span.from), clock(span.to)],
    trends: [
      chart('HFD px', [trends.hfd], twoDigits(trends.hfd), span, true),
      chart('Stars', [trends.stars], whole(trends.stars), span, true),
      chart('Guiding px RA / Dec', [trends.guideRa, trends.guideDec], `${twoDigits(trends.guideRa)} / ${twoDigits(trends.guideDec)}`, span, false),
      chart('Temp °C air / focuser', [trends.airTemperature, trends.focuserTemperature], `${oneDigit(trends.airTemperature)} / ${oneDigit(trends.focuserTemperature)}`, span, false, true),
      chart('Dew heater %', dewLines, dewLines.length === 0 ? unknown : dewLines.map(whole).join(' / '), span, false, true),
      chart('Humidity %', [trends.humidity], whole(trends.humidity), span, false, true),
    ],
  }
}

function trendWindows(trends: Trends, now: number): Readonly<Record<TrendWindowName, TrendView>> {
  return {
    hour: trendView(trends, { from: now - hour, to: now }),
    run: trendView(trends, { from: trends.since ?? now - hour, to: now }),
  }
}

export interface Live {
  readonly run: Run | undefined
  readonly frames: ReadonlyArray<Frame>
  readonly devices: Devices
  readonly guiding: Guiding
  readonly now: number | undefined
  readonly trends: Trends
}

export function liveCapturing({ run, frames, devices, guiding, now, trends }: Live, placeholder: Capturing): Capturing {
  const live = { ...placeholder, rig: rigLine(devices, guiding, now), trendWindows: now === undefined ? placeholder.trendWindows : trendWindows(trends, now) }

  if (run === undefined) return live

  const latest = latestMeasured(frames)

  return {
    ...live,
    frame: run.frames,
    facts: [run.object, `${run.exposureSeconds} s`, `Since ${clock(run.startedAt)}`, run.count === undefined ? 'Until stopped' : `${run.count} frames`],
    latest: {
      detail: latest === undefined ? unknown : `${run.frames} · ${clock(latest.keptAt, true)}`,
      stats: latestStats(latest),
    },
  }
}
