import { Chart } from '../../components/Chart.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Statement } from '../../components/Statement.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { autofocus } from './stub.ts'
import { useFilterAnswer } from './use-filter-answer.ts'

export function FocusStep() {
  const filter = useFilterAnswer()

  return (
    <LaunchStep step={5} title="Autofocus" facts={[autofocus.sample, `Filter ${filter}`]}>
      <Chart
        title="HFD by position"
        lines={[autofocus.curve]}
        yTicks={autofocus.ticks}
        xLabels={autofocus.span}
        marker={autofocus.best}
      />

      <Readings rows={autofocus.result} />

      <Statement size="instruction">Walk in</Statement>
    </LaunchStep>
  )
}
