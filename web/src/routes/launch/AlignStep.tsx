import { Alert } from '../../components/Alert.tsx'
import { Chart } from '../../components/Chart.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Readout } from '../../components/Readout.tsx'
import { Statement } from '../../components/Statement.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { alignErrorTicks, alignGoodBand, alignment } from './stub.ts'

export function AlignStep() {
  const align = alignment.adjusting

  return (
    <LaunchStep
      step={3}
      title="Polar align"
      facts={align.facts}
      action={<PillLink to={align.action.to}>{align.action.label}</PillLink>}
    >
      {align.alert === undefined ? null : <Alert title={align.alert.title} facts={align.alert.facts} />}

      <Readout items={align.error} />

      <Statement size="instruction">{align.instruction}</Statement>

      <Readings rows={align.summary} />

      <Chart
        title="Total error ′"
        lines={[align.totals]}
        yTicks={alignErrorTicks}
        xLabels={['Frame 1', align.lastFrame]}
        band={alignGoodBand}
      />
    </LaunchStep>
  )
}
