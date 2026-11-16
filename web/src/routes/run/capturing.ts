import type { ChartProps } from '../../components/Chart.tsx'
import type { Reading } from '../../components/Readings.tsx'
import type { TrendWindowName } from './TrendWindow.tsx'

export interface Trend {
  readonly chart: Omit<ChartProps, 'xLabels'>
  readonly onPhone: boolean
}

export interface AlertFix {
  readonly label: string
  readonly to?: string
}

export interface RunAlert {
  readonly title: string
  readonly facts: ReadonlyArray<string>
  readonly fixes: ReadonlyArray<AlertFix>
}

export interface Capturing {
  readonly frame: number
  readonly facts: ReadonlyArray<string>
  readonly alert: RunAlert | undefined
  readonly rig: ReadonlyArray<Reading>
  readonly latest: { readonly detail: string; readonly stats: ReadonlyArray<Reading> }
  readonly trendWindows: Readonly<Record<TrendWindowName, TrendView>>
}

export interface TrendView {
  readonly trends: ReadonlyArray<Trend>
  readonly span: readonly [string, string]
}
