import { Alert } from '../../components/Alert.tsx'
import { Chart } from '../../components/Chart.tsx'
import { useNavigate } from 'react-router'

import { CommandPill } from '../../components/CommandPill.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Readout } from '../../components/Readout.tsx'
import { Statement } from '../../components/Statement.tsx'
import { isRunning } from '../../../../state/operations.ts'
import { useRig } from '../../rig/store.ts'
import { LaunchStep } from './LaunchStep.tsx'
import { alignErrorTicks, alignGoodBand, alignment } from './stub.ts'

export function AlignStep() {
  const align = alignment.adjusting
  const navigate = useNavigate()
  const aligning = isRunning(useRig(rig => rig.operations.align))
  const action = aligning ? (
    <CommandPill request={{ command: 'finishAlignment' }} onCarriedOut={() => navigate('/launch/filter')}>
      Done
    </CommandPill>
  ) : (
    <CommandPill request={{ command: 'startAlignment' }}>Start</CommandPill>
  )

  return (
    <LaunchStep
      step={3}
      title="Polar align"
      facts={align.facts}
      action={action}
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
