import type { TargetSkyPath } from '@vela/model/web'
import { skyTime } from './sky-time'

/** Time/altitude projection of the server's samples; no assumed local obstructions. */
export function AltitudeTrace({ sky, stale }: { sky: TargetSkyPath; stale: boolean }) {
  const start = Date.parse(sky.startsAt)
  const duration = Date.parse(sky.endsAt) - start

  if (duration <= 0 || sky.samples.length < 2) return null
  const x = (at: string) => 18 + ((Date.parse(at) - start) / duration) * 244
  const y = (altitude: number) => 121 - (Math.max(0, altitude) / 90) * 110
  const points = sky.samples.map((sample) => `${x(sample.at)},${y(sample.altitudeDegrees)}`)
  const observed = Date.parse(sky.observedAt)
  const nowX = x(sky.observedAt)
  const nowY = y(sky.currentAltitudeDegrees)
  const inSpan = observed >= start && observed <= start + duration

  const past = sky.samples
    .filter((sample) => Date.parse(sample.at) < observed)
    .map((sample) => `${x(sample.at)},${y(sample.altitudeDegrees)}`)

  if (inSpan) past.push(`${nowX},${nowY}`)

  return (
    <svg
      className="tonight-sky__trace"
      viewBox="0 0 278 150"
      role="img"
      aria-label={`Altitude from ${skyTime(sky.startsAt)} to ${skyTime(sky.endsAt)}. ${stale ? 'Last calculated' : 'Calculated'} altitude ${Math.round(sky.currentAltitudeDegrees)} degrees.`}
    >
      <path d="M18 121H262" className="tonight-sky__axis" />
      <polyline points={points.join(' ')} className="tonight-sky__future" />
      <polyline points={past.join(' ')} className="tonight-sky__past" />
      {inSpan && (
        <>
          <path d={`M${nowX} ${nowY}V121`} className="tonight-sky__future" />
          <circle cx={nowX} cy={nowY} r="10" className="tonight-sky__marker" />
          <circle cx={nowX} cy={nowY} r="4" fill="currentColor" />
        </>
      )}
      <text x="9" y="144">
        {skyTime(sky.startsAt)}
      </text>
      {inSpan && nowX > 65 && nowX < 213 && (
        <text x={nowX} y="144" textAnchor="middle">
          {stale ? 'Last' : 'Now'}
        </text>
      )}
      <text x="269" y="144" textAnchor="end">
        {skyTime(sky.endsAt)}
      </text>
    </svg>
  )
}
