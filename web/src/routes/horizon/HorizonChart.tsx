import type { HorizonNight } from '../../../../state/horizon-night.ts'
import type { Layer } from '../../../../state/horizon-layers.ts'
import { clearAt, clockIn, footprintAtTime, frameLabel, hourTicks, lineNote, lineRuns, meridianAzimuths, moonMarkAt, moonPieces, nowPoint, pathPieces, skyPointAt, turnsOfChart, type SkyPoint } from '../../../../state/horizon-view.ts'
import styles from './HorizonChart.module.css'

interface HorizonChartProps {
  readonly night: HorizonNight
  readonly now: number | undefined
  readonly selected: number
  readonly layers: ReadonlySet<Layer>
}

const width = 1344
const height = 470
const left = 40
const right = 1336
const top = 14
const bottom = 440
const compassY = 462
const maxAltitude = 90
const altitudeStep = 15
const compassStep = 45
const compassNames = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW', 'N']
const labelMargin = 170
const nowDotRadius = 5
const selectedDotRadius = 7
const selectedRingRadius = 12
const tickRadius = 3
const nameLift = 26
const tickLift = 10
const edgeMargin = 100
const moonDiscRadius = 8
const moonGlowRadius = 150
const moonLabelGap = 16
const moonLabelWidth = 250
const frameLabelGap = 16
const frameLabelWidth = 520

const xOf = (azimuthDegrees: number) => left + (azimuthDegrees / 360) * (right - left)

const yOf = (altitudeDegrees: number) => bottom - (altitudeDegrees / maxAltitude) * (bottom - top)

const pointsOf = (points: ReadonlyArray<SkyPoint>) => points.map(point => `${xOf(point.azimuthDegrees).toFixed(1)},${yOf(point.altitudeDegrees).toFixed(1)}`).join(' ')

const filled = (points: ReadonlyArray<SkyPoint>) => {
  const first = points[0]
  const last = points.at(-1)

  return first === undefined || last === undefined ? '' : `${xOf(first.azimuthDegrees).toFixed(1)},${bottom} ${pointsOf(points)} ${xOf(last.azimuthDegrees).toFixed(1)},${bottom}`
}

export function HorizonChart({ night, now, selected, layers }: HorizonChartProps) {
  const runs = lineRuns(night.horizon)
  const note = lineNote(night.horizon)
  const assumed = runs.filter(run => !run.known)
  const widest = assumed.reduce<(typeof assumed)[number] | undefined>((best, run) => (best === undefined || run.points.length > best.points.length ? run : best), undefined)
  const widestFirst = widest?.points[0]
  const widestLast = widest?.points.at(-1)
  const noteX = widestFirst === undefined || widestLast === undefined ? undefined : Math.min(Math.max((xOf(widestFirst.azimuthDegrees) + xOf(widestLast.azimuthDegrees)) / 2, left + labelMargin), right - labelMargin)
  const pieces = pathPieces(night.path, night.clear)
  const ticks = hourTicks(night.path, night.zone)
  const here = nowPoint(night.path, now)
  const chosen = nowPoint(night.path, selected)
  const chosenClear = clearAt(night, selected)
  const meridians = meridianAzimuths(night)
  const peak = skyPointAt(night.path, night.facts.highest.at)
  const moonOn = layers.has('moon')
  const moonPaths = moonOn ? moonPieces(night) : []
  const moon = moonOn ? moonMarkAt(night, selected) : undefined
  const moonX = moon === undefined ? 0 : xOf(moon.point.azimuthDegrees)
  const moonLabelLeft = moonX + moonDiscRadius + moonLabelGap + moonLabelWidth > right
  const frameOn = layers.has('frame')
  const footprint = frameOn && chosen !== undefined ? footprintAtTime(night, selected) : undefined
  const footprintCopies = footprint === undefined ? [] : turnsOfChart(footprint)
  const frameWords = frameOn ? frameLabel(night, clockIn(night.zone)) : undefined
  const frameX = frameWords === undefined ? 0 : xOf(frameWords.point.azimuthDegrees)
  const frameLabelLeft = frameX + frameLabelGap + frameLabelWidth > right
  const altitudes = Array.from({ length: maxAltitude / altitudeStep }, (_, index) => (index + 1) * altitudeStep)

  return (
    <div className={styles.scroll}>
      <svg className={styles.chart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${night.target.name} against the horizon, night of ${night.night}`}>
        <defs>
          <radialGradient id="moon-glow">
            <stop offset="0%" className={styles.glowCentre} />
            <stop offset="100%" className={styles.glowEdge} />
          </radialGradient>
        </defs>

        {altitudes.map(altitude => (
          <g key={altitude}>
            <line className={styles.grid} x1={left} x2={right} y1={yOf(altitude)} y2={yOf(altitude)} />
            <text className={styles.altitude} x={left - 10} y={yOf(altitude) + 4}>{`${altitude}°`}</text>
          </g>
        ))}

        {compassNames.map((name, index) => (
          <text key={`${name}${index}`} className={styles.compass} x={xOf(index * compassStep)} y={compassY}>{name}</text>
        ))}

        {meridians.map(azimuth => (
          <g key={azimuth}>
            <line className={styles.meridian} x1={xOf(azimuth)} x2={xOf(azimuth)} y1={bottom} y2={top} />
            <text className={styles.meridianLabel} x={xOf(azimuth) + (azimuth === 360 ? -8 : 8)} y={top + 9} textAnchor={azimuth === 360 ? 'end' : 'start'}>Meridian · flip</text>
          </g>
        ))}

        {runs.map((run, index) =>
          run.known ? (
            <g key={index}>
              <polygon className={styles.treesFill} points={filled(run.points)} />
              <polyline className={styles.treesEdge} points={pointsOf(run.points)} />
            </g>
          ) : (
            <polyline key={index} className={styles.assumed} points={pointsOf(run.points)} />
          ),
        )}

        {note === undefined || noteX === undefined ? null : (
          <text className={styles.assumedLabel} x={noteX} y={yOf(night.horizon.upLineDegrees) - 8}>{note}</text>
        )}

        <line className={styles.axis} x1={left} x2={right} y1={bottom} y2={bottom} />

        {moon === undefined ? null : (
          <circle className={styles.moonGlow} cx={moonX} cy={yOf(moon.point.altitudeDegrees)} r={moonGlowRadius * night.moon.litFraction} fill="url(#moon-glow)" />
        )}

        {moonPaths.map((piece, index) => (
          <polyline key={`moon${index}`} className={styles.moonPath} points={pointsOf(piece.points)} />
        ))}

        {pieces.map((piece, index) => (
          <polyline key={index} className={piece.clear ? styles.pathClear : styles.pathOther} points={pointsOf(piece.points)} />
        ))}

        {ticks.map(tick => (
          <g key={tick.at}>
            <circle className={styles.tick} cx={xOf(tick.point.azimuthDegrees)} cy={yOf(tick.point.altitudeDegrees)} r={tickRadius} />
            <text className={styles.tickLabel} x={xOf(tick.point.azimuthDegrees)} y={yOf(tick.point.altitudeDegrees) - tickLift}>{tick.label}</text>
          </g>
        ))}

        {peak === undefined ? null : <text className={styles.name} x={xOf(peak.azimuthDegrees)} y={yOf(peak.altitudeDegrees) - nameLift}>{night.target.name}</text>}

        {here === undefined ? null : (
          <g>
            <circle className={styles.nowDot} cx={xOf(here.azimuthDegrees)} cy={yOf(here.altitudeDegrees)} r={nowDotRadius} />
            <text
              className={styles.nowLabel}
              x={xOf(here.azimuthDegrees) + (xOf(here.azimuthDegrees) < left + edgeMargin ? 10 : -10)}
              y={yOf(here.altitudeDegrees) + 4}
              textAnchor={xOf(here.azimuthDegrees) < left + edgeMargin ? 'start' : 'end'}
            >
              NOW
            </text>
          </g>
        )}

        {footprintCopies.map((copy, index) => (
          <polygon key={`frame${index}`} className={styles.frameBox} points={pointsOf(copy)} />
        ))}

        {frameWords === undefined ? null : (
          <text
            className={styles.frameLabel}
            x={frameX + (frameLabelLeft ? -frameLabelGap : frameLabelGap)}
            y={yOf(frameWords.point.altitudeDegrees) + 4}
            textAnchor={frameLabelLeft ? 'end' : 'start'}
          >
            {frameWords.words}
          </text>
        )}

        {chosen === undefined ? null : (
          <g aria-hidden="true">
            <circle className={styles.selectedRing} cx={xOf(chosen.azimuthDegrees)} cy={yOf(chosen.altitudeDegrees)} r={selectedRingRadius} />
            <circle className={chosenClear ? styles.selectedClear : styles.selectedOther} cx={xOf(chosen.azimuthDegrees)} cy={yOf(chosen.altitudeDegrees)} r={selectedDotRadius} />
          </g>
        )}

        {moon === undefined ? null : (
          <g>
            <circle className={styles.moonDisc} cx={moonX} cy={yOf(moon.point.altitudeDegrees)} r={moonDiscRadius} />
            <text
              className={styles.moonLabel}
              x={moonX + (moonLabelLeft ? -(moonDiscRadius + moonLabelGap) : moonDiscRadius + moonLabelGap)}
              y={yOf(moon.point.altitudeDegrees) + 4}
              textAnchor={moonLabelLeft ? 'end' : 'start'}
            >
              {moon.words}
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
