import type { AutofocusFit, AutofocusSample } from '@vela/model/web'

function hyperbola(x: number, a: number, b: number, p: number) {
  return a * Math.sqrt(1 + ((x - p) / b) ** 2)
}

export function AutofocusCurve({
  start,
  current,
  samples,
  fit,
  stepSize,
  offsetSteps,
}: {
  start: number
  current: number | null
  samples: AutofocusSample[]
  fit: AutofocusFit | null
  stepSize: number
  offsetSteps: number
}) {
  const width = 640
  const height = 280
  const left = 48
  const right = 18
  const top = 16
  const bottom = 36
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const span = Math.max(offsetSteps * stepSize, 1)
  const low = Math.min(start - span, ...samples.map(sample => sample.position), fit?.position ?? start)
  const high = Math.max(start + span, ...samples.map(sample => sample.position), fit?.position ?? start)
  const pad = Math.max(high - low, 1) * 0.08
  const xMin = low - pad
  const xMax = high + pad
  const hfrs = samples.map(sample => sample.hfrPixels).filter((value): value is number => value !== null)
  const yMax = Math.max(6, ...hfrs, fit ? hyperbola(high, fit.a, fit.b, fit.p) : 0) * 1.12
  const x = (position: number) => left + ((position - xMin) / (xMax - xMin)) * plotWidth
  const y = (hfr: number) => top + (1 - hfr / yMax) * plotHeight
  const ticks = [low, start, high]
  const latest = samples.at(-1)
  const lowest = hfrs.length
    ? samples.reduce((best, sample) => sample.hfrPixels !== null && (best.hfrPixels === null || sample.hfrPixels < best.hfrPixels) ? sample : best)
    : null
  const curve = fit
    ? Array.from({ length: 49 }, (_, index) => {
        const position = xMin + (index / 48) * (xMax - xMin)

        return `${index === 0 ? 'M' : 'L'}${x(position).toFixed(1)} ${y(hyperbola(position, fit.a, fit.b, fit.p)).toFixed(1)}`
      }).join(' ')
    : ''

  return (
    <svg className="vela-af-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Autofocus V-curve of focuser position versus star HFR">
      {[0.25, 0.5, 0.75, 1].map(fraction => (
        <line key={fraction} className="vela-af-grid" x1={left} x2={width - right} y1={y(yMax * fraction)} y2={y(yMax * fraction)} />
      ))}
      <line className="vela-af-axis" x1={left} y1={top} x2={left} y2={height - bottom} />
      <line className="vela-af-axis" x1={left} y1={height - bottom} x2={width - right} y2={height - bottom} />
      <text x={left} y={12}>HFR · px</text>
      <text x={width - right} y={height - 8} textAnchor="end">Focuser position</text>
      {ticks.map(tick => (
        <g key={tick}>
          <line className="vela-af-grid" x1={x(tick)} x2={x(tick)} y1={top} y2={height - bottom} />
          <text x={x(tick)} y={height - 10} textAnchor="middle">{Math.round(tick)}</text>
        </g>
      ))}
      <line className="vela-af-start" x1={x(start)} x2={x(start)} y1={top} y2={height - bottom} />
      {fit && <line className="vela-af-fit-line" x1={x(fit.position)} x2={x(fit.position)} y1={top} y2={height - bottom} />}
      {curve && <path className="vela-af-hyperbola" d={curve} />}
      {lowest?.hfrPixels != null && <circle className="vela-af-min-sample" cx={x(lowest.position)} cy={y(lowest.hfrPixels)} r="8" />}
      {samples.map((sample, index) => {
        const hfr = sample.hfrPixels ?? yMax * 0.08

        return (
          <circle
            key={`${sample.position}-${index}`}
            className="vela-af-point"
            data-latest={index === samples.length - 1 || undefined}
            data-empty={sample.hfrPixels === null || undefined}
            cx={x(sample.position)}
            cy={y(hfr)}
            r={index === samples.length - 1 ? 5 : 4}
          />
        )
      })}
      {current !== null && latest && (
        <text x={x(current)} y={Math.max(28, y(latest.hfrPixels ?? yMax * 0.08) - 12)} textAnchor="middle">now</text>
      )}
    </svg>
  )
}
