import type { AutofocusFit, AutofocusSample } from '@vela/model/web'
import { useEffect, useRef, useState } from 'react'

function hyperbola(x: number, fit: AutofocusFit) {
  return fit.a * Math.sqrt(1 + ((x - fit.p) / fit.b) ** 2)
}

export function AutofocusCurve({
  start,
  samples,
  fit,
  stepSize,
  offsetSteps,
}: {
  start: number
  samples: AutofocusSample[]
  fit: AutofocusFit | null
  stepSize: number
  offsetSteps: number
}) {
  const element = useRef<SVGSVGElement>(null)
  const [size, setSize] = useState({ width: 838, compact: false })

  useEffect(() => {
    const svg = element.current

    if (!svg) return
    const compact = window.matchMedia('(max-width: 600px)')

    function measure() {
      const width = svg!.getBoundingClientRect().width

      if (width > 0)
        setSize(current =>
          current.width === width && current.compact === compact.matches
            ? current
            : { width, compact: compact.matches },
        )
    }

    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    compact.addEventListener('change', measure)
    measure()

    return () => {
      observer.disconnect()
      compact.removeEventListener('change', measure)
    }
  }, [])

  const { width, compact } = size
  const height = compact ? 146 : 280
  const left = compact ? 32 : 64
  const right = compact ? 14 : 24
  const top = compact ? 18 : 32
  const bottom = compact ? 32 : 56
  const span = Math.max(offsetSteps * stepSize, 1)

  const low = Math.min(
    start - span,
    ...samples.map(sample => sample.position),
    fit?.position ?? start,
  )

  const high = Math.max(
    start + span,
    ...samples.map(sample => sample.position),
    fit?.position ?? start,
  )

  const pad = Math.max(high - low, 1) * 0.08
  const xMin = low - pad
  const xMax = high + pad
  const measured = samples.filter(sample => sample.hfrPixels !== null)

  const largest = Math.max(
    0,
    ...measured.map(sample => sample.hfrPixels!),
    fit ? hyperbola(xMin, fit) : 0,
    fit ? hyperbola(xMax, fit) : 0,
  )

  const yMax = Math.max(6, Math.ceil(largest / 2) * 2)

  const x = (position: number) =>
    left + ((position - xMin) / (xMax - xMin)) * (width - left - right)

  const y = (hfr: number) => top + (1 - hfr / yMax) * (height - top - bottom)

  const lowest = measured.reduce<AutofocusSample | null>(
    (best, sample) =>
      !best || sample.hfrPixels! < best.hfrPixels! ? sample : best,
    null,
  )

  const curve = fit
    ? Array.from({ length: 49 }, (_, index) => {
        const position = xMin + (index / 48) * (xMax - xMin)

        return `${index === 0 ? 'M' : 'L'}${x(position).toFixed(2)} ${y(hyperbola(position, fit)).toFixed(2)}`
      }).join(' ')
    : null

  return (
    <svg
      ref={element}
      className="vela-af-chart"
      viewBox={`0 0 ${width} ${height}`}
      style={{ height }}
      role="img"
      aria-label="Autofocus V-curve of focuser position versus star HFR"
    >
      {(compact ? [0, 0.5, 1] : [0, 1 / 3, 2 / 3, 1]).map(fraction => (
        <g key={fraction}>
          <line
            className="vela-af-grid"
            x1={left}
            x2={width - right}
            y1={y(fraction * yMax)}
            y2={y(fraction * yMax)}
          />
          <text
            className="vela-af-y-tick"
            x={left - 20}
            y={y(fraction * yMax) + 5}
            textAnchor="end"
          >
            {Number((fraction * yMax).toFixed(1))}
          </text>
        </g>
      ))}
      <path
        className="vela-af-axis"
        d={`M${left} ${top}V${height - bottom}H${width - right}`}
      />
      <line
        className="vela-af-start"
        x1={x(start)}
        x2={x(start)}
        y1={top}
        y2={height - bottom}
      />
      {[low, start, high].map(tick => (
        <text
          key={tick}
          x={x(tick)}
          y={height - (compact ? 7 : 31)}
          textAnchor="middle"
        >
          {Math.round(tick).toLocaleString()}
        </text>
      ))}
      {!compact && (
        <>
          <text x={left} y={17}>
            HFR · px
          </text>
          <text
            className="vela-af-start-label"
            x={x(start)}
            y={17}
            textAnchor="middle"
          >
            Start {start.toLocaleString()}
          </text>
          <text
            x={(left + width - right) / 2}
            y={height - 5}
            textAnchor="middle"
          >
            Focuser position
          </text>
        </>
      )}
      {fit && (
        <line
          className="vela-af-fit-line"
          x1={x(fit.position)}
          x2={x(fit.position)}
          y1={top}
          y2={height - bottom}
        />
      )}
      {curve && <path className="vela-af-hyperbola" d={curve} />}
      {samples.map((sample, index) => (
        <circle
          key={`${sample.position}-${index}`}
          className="vela-af-point"
          data-latest={index === samples.length - 1 || undefined}
          data-empty={sample.hfrPixels === null || undefined}
          cx={x(sample.position)}
          cy={
            sample.hfrPixels === null
              ? height - bottom - 6
              : y(sample.hfrPixels)
          }
          r={
            compact
              ? index === samples.length - 1
                ? 4.5
                : 4
              : index === samples.length - 1
                ? 6
                : 5
          }
        >
          <title>
            {sample.position.toLocaleString()} ·{' '}
            {sample.hfrPixels === null
              ? 'No measurable stars; marker shows position only'
              : `${sample.hfrPixels.toFixed(2)} px HFR`}
          </title>
        </circle>
      ))}
      {lowest?.hfrPixels !== null && lowest && (
        <circle
          className="vela-af-min-sample"
          cx={x(lowest.position)}
          cy={y(lowest.hfrPixels)}
          r={compact ? 8 : 10}
        />
      )}
    </svg>
  )
}
