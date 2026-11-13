import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import { Chart } from '../../components/Chart.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Statement } from '../../components/Statement.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { autofocus } from './stub.ts'
import { useRig } from '../../rig/store.ts'
import { useFilterAnswer } from './use-filter-answer.ts'

export function FocusStep() {
  const filter = useFilterAnswer()
  const focus = useRig(rig => rig.operations.focus)
  const navigate = useNavigate()
  const seenRunning = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (focus?.status === 'running') seenRunning.current = focus.run
    if (focus?.status === 'ended' && seenRunning.current === focus.run) navigate('/launch/ready')
  }, [focus, navigate])

  return (
    <LaunchStep step={5} title="Autofocus" facts={[autofocus.sample, `Filter ${filter ?? '—'}`]}>
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
