import { Chart } from '../../components/Chart.tsx'
import styles from './Trends.module.css'
import type { Trend } from './stub.ts'

interface TrendsProps {
  readonly trends: ReadonlyArray<Trend>
  readonly span: readonly [string, string]
}

export function Trends({ trends, span }: TrendsProps) {
  return (
    <div className={styles.trends}>
      {trends.map(trend => (
        <div key={trend.chart.title} className={trend.onPhone ? undefined : styles.wideOnly}>
          <Chart {...trend.chart} />
        </div>
      ))}

      <div className={styles.span}>
        <span>{span[0]}</span>
        <span>{span[1]}</span>
      </div>
    </div>
  )
}
