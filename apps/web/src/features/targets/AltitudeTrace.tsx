import type { TargetSkyPath } from '@vela/model/web'
import { horizonNote, horizonRuns, observedRuns } from './horizon'
import { skyTime } from './sky-time'

/** Time/altitude projection of the server's samples, marked where the rig's approximate horizon profile hides or does not cover the target. */
export function AltitudeTrace({
  sky,
  stale,
  variant = 'tonight',
}: {
  sky: TargetSkyPath
  stale: boolean
  variant?: 'tonight' | 'explore'
}) {
  const start = Date.parse(sky.startsAt)
  const duration = Date.parse(sky.endsAt) - start

  if (duration <= 0 || sky.samples.length < 2) return null
  const explore = variant === 'explore'

  const plot = explore
    ? { width: 382, height: 196, left: 35, right: 370, top: 30, baseline: 160, timeY: 185 }
    : { width: 278, height: 150, left: 18, right: 262, top: 11, baseline: 121, timeY: 144 }

  const x = (at: string) =>
    plot.left + ((Date.parse(at) - start) / duration) * (plot.right - plot.left)

  const y = (altitude: number) =>
    plot.baseline - (Math.max(0, altitude) / 90) * (plot.baseline - plot.top)

  const points = sky.samples.map((sample) => `${x(sample.at)},${y(sample.altitudeDegrees)}`)
  const observed = Date.parse(sky.observedAt)
  const nowX = x(sky.observedAt)
  const nowY = y(sky.currentAltitudeDegrees)
  const inSpan = observed >= start && observed <= start + duration

  const past = sky.samples
    .filter((sample) => Date.parse(sample.at) < observed)
    .map((sample) => `${x(sample.at)},${y(sample.altitudeDegrees)}`)

  if (inSpan) past.push(`${nowX},${nowY}`)

  const marked = (status: 'behind' | 'unknown') =>
    horizonRuns(sky, status).map(({ from, to }) =>
      sky.samples
        .slice(from, to + 2)
        .map((sample) => `${x(sample.at)},${y(sample.altitudeDegrees)}`)
        .join(' '),
    )

  return (
    <svg
      className="tonight-sky__trace"
      data-variant={variant}
      viewBox={`0 0 ${plot.width} ${plot.height}`}
      role="img"
      aria-label={`Altitude from ${skyTime(sky.startsAt)} to ${skyTime(sky.endsAt)}. ${stale ? 'Last calculated' : 'Calculated'} altitude ${Math.round(sky.currentAltitudeDegrees)} degrees.${horizonNote(sky).map((line) => ` ${line}`).join('')}`}
    >
      <path d={`M${plot.left} ${plot.baseline}H${plot.right}`} className="tonight-sky__axis" />
      {explore && (
        <>
          <path
            d={`M${plot.left} ${plot.top - 5}V${plot.baseline}`}
            className="tonight-sky__axis"
          />
          {[90, 60, 30].map((altitude) => (
            <g key={altitude}>
              <path
                d={`M${plot.left} ${y(altitude)}H${plot.right}`}
                className="tonight-sky__axis"
              />
              <text x="0" y={y(altitude) + 4}>
                {altitude}°
              </text>
            </g>
          ))}
        </>
      )}
      <polyline points={points.join(' ')} className="tonight-sky__future" />
      <polyline points={past.join(' ')} className="tonight-sky__past" />
      {marked('unknown').map((points) => (
        <polyline key={points} points={points} className="tonight-sky__unknown" />
      ))}
      {marked('behind').map((points) => (
        <polyline key={points} points={points} className="tonight-sky__behind" />
      ))}
      {observedRuns(sky).map(({ from }) => (
        <circle
          key={from}
          cx={x(sky.samples[from]!.at)}
          cy={y(sky.samples[from]!.altitudeDegrees)}
          r="5"
          className="tonight-sky__observed"
        />
      ))}
      {inSpan && (
        <>
          <path
            d={`M${nowX} ${explore ? plot.top : nowY}V${plot.baseline}`}
            className="tonight-sky__future"
            strokeDasharray={explore ? '3 5' : undefined}
          />
          {!explore && <circle cx={nowX} cy={nowY} r="10" className="tonight-sky__marker" />}
          <circle cx={nowX} cy={nowY} r={explore ? 6 : 4} fill="currentColor" />
        </>
      )}
      <text x={explore ? 28 : 9} y={plot.timeY}>
        {skyTime(sky.startsAt)}
      </text>
      {inSpan && nowX > plot.left + 47 && nowX < plot.right - 49 && (
        <text x={nowX} y={plot.timeY} textAnchor="middle">
          {explore ? skyTime(sky.observedAt) : stale ? 'Last' : 'Now'}
        </text>
      )}
      <text x={explore ? 370 : 269} y={plot.timeY} textAnchor="end">
        {skyTime(sky.endsAt)}
      </text>
    </svg>
  )
}
