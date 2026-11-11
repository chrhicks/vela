import styles from './Chart.module.css'

export interface Point {
  readonly x: number
  readonly y: number
}

export interface Band {
  readonly from: number
  readonly to: number
}

export interface ChartProps {
  readonly title: string
  readonly current?: string
  readonly lines: ReadonlyArray<ReadonlyArray<Point>>
  readonly yTicks: ReadonlyArray<number>
  readonly xLabels?: readonly [string, string]
  readonly band?: Band
  readonly marker?: Point
}

interface Range {
  readonly min: number
  readonly max: number
}

function rangeOf(values: ReadonlyArray<number>): Range {
  return { min: Math.min(...values), max: Math.max(...values) }
}

function along(value: number, range: Range): number {
  return range.max === range.min ? 0 : ((value - range.min) / (range.max - range.min)) * 100
}

export function Chart({ title, current, lines, yTicks, xLabels, band, marker }: ChartProps) {
  const xs = rangeOf(lines.flatMap(line => line.map(point => point.x)))
  const ys = rangeOf(yTicks)
  const left = (x: number) => along(x, xs)
  const top = (y: number) => 100 - along(y, ys)

  return (
    <figure className={styles.chart}>
      <figcaption className={styles.caption}>
        <span className={styles.title}>{title}</span>

        {current === undefined ? null : <span className={styles.current}>{current}</span>}
      </figcaption>

      <div className={styles.body}>
        <ol className={styles.ticks}>
          {yTicks.map(tick => (
            <li key={tick} className={styles.tick} style={{ top: `${top(tick)}%` }}>
              {tick}
            </li>
          ))}
        </ol>

        <div className={styles.plot}>
          <svg className={styles.drawing} viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {band === undefined ? null : (
              <rect className={styles.band} x="0" width="100" y={top(band.to)} height={top(band.from) - top(band.to)} />
            )}

            {lines.map((line, index) => (
              <polyline
                key={index}
                className={styles.line}
                points={line.map(point => `${left(point.x)},${top(point.y)}`).join(' ')}
              />
            ))}
          </svg>

          {marker === undefined ? null : (
            <span className={styles.marker} style={{ left: `${left(marker.x)}%`, top: `${top(marker.y)}%` }} />
          )}
        </div>
      </div>

      {xLabels === undefined ? null : (
        <div className={styles.span}>
          <span>{xLabels[0]}</span>
          <span>{xLabels[1]}</span>
        </div>
      )}
    </figure>
  )
}
