import { useEffect, useId, useRef, useState } from 'react'
import { angularSeparationDegrees, horizonAt, horizonSectors, projectSky, visibleSkyPath, type HorizonPoint, type SkyCoordinate } from './sky-path-geometry'

export type SkyLightPhase = 'daylight' | 'civil' | 'nautical' | 'astronomical' | 'night'

const skyLightLabels: Record<SkyLightPhase, string> = {
  daylight: 'Daylight', civil: 'Civil twilight', nautical: 'Nautical twilight',
  astronomical: 'Astronomical twilight', night: 'Astronomical darkness',
}

export type SkyPathSample = SkyCoordinate & {
  label: string
  /** Optional caller-supplied phase. Applies from this sample to the next. */
  light?: SkyLightPhase
}

export type SkyPathMoonSample = SkyCoordinate & { illuminationFraction: number; waxing: boolean }

export type SkyPathHorizon = {
  state: 'calibrated' | 'uncalibrated'
  points: readonly HorizonPoint[]
  wires?: readonly (readonly SkyCoordinate[])[]
}

export type SkyPathProps = {
  /** Samples are ordered at equal time intervals. No astronomy is calculated here. */
  samples: readonly SkyPathSample[]
  /** Lunar positions share the target samples' time indices. Null means unavailable. */
  moonSamples?: readonly (SkyPathMoonSample | null)[]
  targetName: string
  selectedIndex: number
  onSelectedIndexChange: (index: number) => void
  nowIndex?: number
  /** Text for the reference-time marker, such as Last calculation for stale data. */
  nowLabel?: string
  horizon?: SkyPathHorizon
  marginDegrees?: number
  onMarginDegreesChange?: (degrees: number) => void
  compact?: boolean
}

export function SkyPath({ samples, moonSamples, targetName, selectedIndex, onSelectedIndexChange, nowIndex, nowLabel = 'Now', horizon, marginDegrees = 5, onMarginDegreesChange, compact = false }: SkyPathProps) {
  const root = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(280)
  const id = useId()
  useEffect(() => {
    const element = root.current

    if (!element) return

    const observer = new ResizeObserver(entries => {
      const measured = entries[0]?.contentRect.width

      if (measured) setWidth(measured)
    })

    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  const size = Math.max(180, width)
  const center = size / 2
  const radius = center - 27
  const safeIndex = Number.isFinite(selectedIndex) ? Math.round(selectedIndex) : 0
  const index = Math.max(0, Math.min(samples.length - 1, safeIndex))
  const selected = samples[index]
  const hasLight = samples.some(sample => sample.light !== undefined)
  const lightStatus = hasLight ? selected?.light ? skyLightLabels[selected.light] : 'Light phase unavailable' : undefined
  const moon = selected ? moonSamples?.[index] : undefined

  const moonStatus = moonSamples === undefined ? undefined
    : !moon ? 'Moon position unavailable'
    : moon.altitudeDegrees < 0 ? 'Moon below horizon'
    : `Moon · ${Math.round(Math.max(0, Math.min(1, moon.illuminationFraction)) * 100)}% illuminated · ${Math.round(angularSeparationDegrees(selected!, moon))}° from target`

  const now = nowIndex === undefined ? undefined : samples[nowIndex]
  const margin = Number.isFinite(marginDegrees) ? Math.max(0, Math.min(30, marginDegrees)) : 5
  const sectors = horizon ? horizonSectors(horizon.points, margin, center, radius) : []
  const localAltitude = selected && horizon ? horizonAt(horizon.points, selected.azimuthDegrees) : null

  const selectedStatus = !selected ? 'No path samples available'
    : selected.altitudeDegrees < 0 ? 'Below the geometric horizon'
    : !horizon ? 'Local obstructions not included'
    : localAltitude === null ? 'Local horizon unknown in this direction'
    : selected.altitudeDegrees < localAltitude ? 'Below the local silhouette'
    : selected.altitudeDegrees < localAltitude + margin ? 'Within the elevation margin'
    : 'Above the silhouette and elevation margin'

  const point = (sample: SkyCoordinate) => projectSky(sample, center, radius)
  const labels = skyLabels(samples, now, nowLabel, selected, moon, size, compact)

  return (
    <div ref={root} className="vela-sky-path" data-compact={compact || undefined}>
      <div className="vela-sky-path__orientation"><span>Looking up</span><span>Zenith at center</span></div>
      <svg className="vela-sky-path__map" viewBox={`0 0 ${size} ${size}`} role="img" aria-labelledby={`${id}-title ${id}-description`}>
        <title id={`${id}-title`}>{targetName} through the night</title>
        <desc id={`${id}-description`}>Overhead sky dome. North is up, east is left. Outer ring is altitude zero; center is altitude 90 degrees. {selected ? `${selected.label}, altitude ${selected.altitudeDegrees.toFixed(0)} degrees. ${selectedStatus}.` : selectedStatus} {lightStatus} {moonStatus}</desc>
        <defs>
          <pattern id={`${id}-unknown`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(35)"><line x1="0" x2="0" y1="0" y2="6" className="vela-sky-path__hatch" /></pattern>
        </defs>
        <circle cx={center} cy={center} r={radius} className="vela-sky-path__dome" />
        {sectors.map((sector, sectorIndex) => <g key={sectorIndex}>
          <path d={sector.silhouette} className={sector.unknown ? 'vela-sky-path__unknown' : 'vela-sky-path__silhouette'} fill={sector.unknown ? `url(#${id}-unknown)` : undefined} />
          {!sector.unknown && margin > 0 && <path d={sector.band} className="vela-sky-path__margin" />}
        </g>)}
        {[0, 30, 60].map(altitude => <circle key={altitude} cx={center} cy={center} r={radius * (90 - altitude) / 90} className="vela-sky-path__grid" />)}
        <path d={`M${center - radius},${center}H${center + radius} M${center},${center - radius}V${center + radius}`} className="vela-sky-path__axis" />
        {labels.altitudes.map(label => <text key={label.text} x={label.x} y={label.y} textAnchor="middle" className="vela-sky-path__altitude">{label.text}</text>)}
        {horizon?.wires?.map((wire, wireIndex) => <path key={wireIndex} d={visibleSkyPath(wire, center, radius)} className="vela-sky-path__wire" />)}
        {hasLight ? samples.slice(0, -1).map((sample, index) => <path key={index}
          d={visibleSkyPath([sample, samples[index + 1]!], center, radius)}
          className="vela-sky-path__track vela-sky-path__light-track" data-light={sample.light ?? 'unknown'}
        />) : <path d={visibleSkyPath(samples, center, radius)} className="vela-sky-path__track" />}
        {labels.times.map(label => <g key={label.sampleIndex}>
          <circle cx={point(samples[label.sampleIndex]!).x} cy={point(samples[label.sampleIndex]!).y} r="2.5" className="vela-sky-path__hour" data-light={samples[label.sampleIndex]!.light} />
          <text x={label.x} y={label.y} textAnchor="middle" className="vela-sky-path__time">{label.text}</text>
        </g>)}
        {now && now.altitudeDegrees >= 0 && <circle cx={point(now).x} cy={point(now).y} r="7" className="vela-sky-path__now" />}
        {labels.now && <text x={labels.now.x} y={labels.now.y} textAnchor="middle" className="vela-sky-path__time">{nowLabel}</text>}
        {moon && moon.altitudeDegrees >= 0 && <g className="vela-sky-path__moon" transform={`translate(${point(moon).x} ${point(moon).y})`}>
          <circle r="8" className="vela-sky-path__moon-disk" />
          <path d={moonPhasePath(moon.illuminationFraction)} transform={moon.waxing ? undefined : 'scale(-1 1)'} className="vela-sky-path__moon-lit" />
        </g>}
        {labels.moon && <text x={labels.moon.x} y={labels.moon.y} textAnchor="middle" className="vela-sky-path__moon-label">Moon</text>}
        {selected && selected.altitudeDegrees >= 0 && <g><circle cx={point(selected).x} cy={point(selected).y} r="10" className="vela-sky-path__selection-halo" /><circle cx={point(selected).x} cy={point(selected).y} r="4.5" className="vela-sky-path__selected" /></g>}
        {[['N', center, 15], ['E', 12, center + 4], ['S', center, size - 7], ['W', size - 12, center + 4]].map(([label, x, y]) => <text key={label} x={x} y={y} textAnchor="middle" className="vela-sky-path__cardinal">{label}</text>)}
        {!samples.length && <text x={center} y={center} textAnchor="middle" className="vela-sky-path__time">No path available</text>}
      </svg>
      <div className="vela-sky-path__readout"><strong>{selected?.label ?? 'No time selected'}</strong>{selected && <span>{selected.altitudeDegrees.toFixed(0)}° altitude</span>}</div>
      {lightStatus && <p className="vela-sky-path__light-status" role="status"><i data-light={selected?.light ?? 'unknown'} />{lightStatus}</p>}
      <label className="vela-sky-path__sr-only" htmlFor={`${id}-time`}>Preview time for {targetName}</label>
      <input id={`${id}-time`} className="vela-sky-path__range" type="range" min="0" max={Math.max(1, samples.length - 1)} step="1" value={Math.max(0, index)} disabled={samples.length < 2} aria-valuetext={selected ? `${selected.label}, ${selected.altitudeDegrees.toFixed(0)} degrees altitude. ${selectedStatus}${lightStatus ? `. ${lightStatus}` : ''}${moonStatus ? `. ${moonStatus}` : ''}` : 'No path samples'} onChange={event => onSelectedIndexChange(Number(event.target.value))} />
      {samples.length > 0 && <div className="vela-sky-path__extent"><span>{samples[0]!.label}</span><span>{samples[samples.length - 1]!.label}</span></div>}
      {hasLight && <div className="vela-sky-path__light-legend" aria-label="Path colors by light phase">{Object.entries(skyLightLabels).map(([phase, label]) => <span key={phase}><i data-light={phase} />{label}</span>)}</div>}
      <p className="vela-sky-path__status">{selectedStatus}{horizon?.state === 'uncalibrated' ? ' · Provisional horizon' : ''}</p>
      {moonStatus && <p className="vela-sky-path__moon-status">{moonStatus}</p>}
      {horizon && <>
        <div className="vela-sky-path__legend"><span><i className="vela-sky-path__legend-silhouette" />Silhouette</span><span><i className="vela-sky-path__legend-margin" />Elevation margin</span>{sectors.some(sector => sector.unknown) && <span><i className="vela-sky-path__legend-unknown" />Unknown</span>}{Boolean(horizon.wires?.length) && <span><i className="vela-sky-path__legend-wire" />Wires</span>}</div>
        <label className="vela-sky-path__margin-label" htmlFor={`${id}-margin`}>Elevation margin <strong>{margin}°</strong></label>
        {onMarginDegreesChange && <input id={`${id}-margin`} className="vela-sky-path__range" type="range" min="0" max="30" step="1" value={margin} aria-valuetext={`${margin} degrees above the silhouette`} onChange={event => onMarginDegreesChange(Number(event.target.value))} />}
        <p className="vela-sky-path__note">Margin follows the silhouette’s elevation; it does not measure wire clearance.{sectors.some(sector => sector.unknown) ? ' Hatched gaps have no known horizon height.' : ''}</p>
      </>}
    </div>
  )
}


type MapLabel = { text: string; x: number; y: number }

type LabelBox = { left: number; right: number; top: number; bottom: number }

// Text stays at a fixed pixel size as the dome resizes. Reserve each label's
// footprint so a short, high-altitude arc does not become a stack of times.
function skyLabels(samples: readonly SkyPathSample[], now: SkyPathSample | undefined, referenceLabel: string, selected: SkyPathSample | undefined, moon: SkyPathMoonSample | null | undefined, size: number, compact: boolean) {
  const center = size / 2
  const radius = center - 27
  const occupied: LabelBox[] = []
  const overlaps = (box: LabelBox) => occupied.some(other => box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top)

  for (const sample of [now, selected, moon]) {
    if (!sample || sample.altitudeDegrees < 0) continue
    const { x, y } = projectSky(sample, center, radius)
    occupied.push({ left: x - 11, right: x + 11, top: y - 11, bottom: y + 11 })
  }

  function place(text: string, positions: { x: number; y: number }[]) {
    const halfWidth = text.length * 3.5 + 4

    for (const position of positions) {
      const box = { left: position.x - halfWidth, right: position.x + halfWidth, top: position.y - 13, bottom: position.y + 4 }

      if (box.left < 24 || box.right > size - 24 || box.top < 24 || box.bottom > size - 24 || overlaps(box)) continue
      occupied.push(box)

      return { text, ...position }
    }

    return undefined
  }

  function near(text: string, sample: SkyCoordinate, belowFirst = false) {
    const { x, y } = projectSky(sample, center, radius)
    const vertical = [{ x, y: y - 16 }, { x, y: y + 26 }]

    if (belowFirst) vertical.reverse()

    return place(text, [...vertical, { x: x - text.length * 3.5 - 16, y: y + 4 }, { x: x + text.length * 3.5 + 16, y: y + 4 }])
  }

  const nowLabel = now && now.altitudeDegrees >= 0 ? near(referenceLabel, now, true) : undefined
  const moonLabel = moon && moon.altitudeDegrees >= 0 ? near('Moon', moon) : undefined

  const altitudes = [30, 60].flatMap(altitude => {
    const y = center + radius * (90 - altitude) / 90 - 5
    const label = place(`${altitude}°`, [{ x: center + 16, y }])

    return label ? [label] : []
  })

  const visible = samples.map((sample, sampleIndex) => ({ sample, sampleIndex })).filter(({ sample }) => sample.altitudeDegrees >= 0)
  const wholeHours = visible.filter(({ sample }) => /(?:^|\s)\d{1,2}:00(?:\s|$)/.test(sample.label))
  const candidates = wholeHours.length ? wholeHours : visible
  const maximum = size < 340 || compact ? 3 : 7
  const count = Math.min(maximum, candidates.length)
  const times: (MapLabel & { sampleIndex: number })[] = []

  for (let index = 0; index < count; index += 1) {
    const candidate = candidates[count === 1 ? 0 : Math.round(index * (candidates.length - 1) / (count - 1))]!
    const label = near(candidate.sample.label, candidate.sample)

    if (label) times.push({ ...label, sampleIndex: candidate.sampleIndex })
  }

  return { now: nowLabel, moon: moonLabel, altitudes, times }
}

// An upright phase symbol: the ellipse is the projected day/night boundary.
// Its orientation indicates waxing or waning, not the Moon's position angle.
function moonPhasePath(illuminationFraction: number) {
  const fraction = Math.max(0, Math.min(1, illuminationFraction))
  const terminatorRadius = Math.abs(1 - 2 * fraction) * 8
  const terminator = terminatorRadius < .001 ? 'L0,-8' : `A${terminatorRadius},8 0 0 ${fraction < .5 ? 0 : 1} 0,-8`

  return `M0,-8 A8,8 0 0 1 0,8 ${terminator} Z`
}
