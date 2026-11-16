import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router'

import { checkOf } from '../../../../state/autofocus.ts'
import { cutShort } from '../../../../state/operations.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Chart } from '../../components/Chart.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Statement } from '../../components/Statement.tsx'
import { autofocusChart } from '../../rig/autofocus-chart.ts'
import { useRig } from '../../rig/store.ts'
import { LaunchStep } from './LaunchStep.tsx'
import { StoppedAlert } from './StoppedAlert.tsx'
import { useFilterAnswer } from './use-filter-answer.ts'

const unknown = '—'

export function FocusStep() {
  const filter = useFilterAnswer()
  const focus = useRig(rig => rig.operations.focus)
  const state = useRig(rig => rig.autofocus)
  const focuserCelsius = useRig(rig => rig.devices.focuser.FOCUS_TEMPERATURE?.values.TEMPERATURE)
  const navigate = useNavigate()
  const seenRunning = useRef<string | undefined>(undefined)

  useEffect(() => {
    if (focus?.status === 'running') seenRunning.current = focus.run
    if (focus?.status === 'ended' && cutShort(focus) === undefined && seenRunning.current === focus.run) navigate('/launch/ready')
  }, [focus, navigate])

  const stopped = cutShort(focus)
  const check = checkOf(state)
  const total = state.positions.length + 1

  return (
    <LaunchStep step={5} title="Autofocus" facts={[state.samples.length === 0 ? 'Starting' : `Sample ${state.samples.length} of ${total}`, `Filter ${filter ?? unknown}`]}>
      {stopped === undefined ? null : (
        <StoppedAlert what="Autofocus" ended={stopped}>
          <ActionLink to="/launch/filter">Try again</ActionLink>
        </StoppedAlert>
      )}

      <Chart {...autofocusChart(state)} />

      <Readings
        rows={[
          { label: 'Best', value: state.best === undefined ? unknown : String(state.best) },
          { label: 'HFD', value: check?.hfd == null ? unknown : `${check.hfd.toFixed(1)} px` },
          { label: 'Stars', value: check === undefined ? unknown : String(check.stars) },
          { label: 'Temp', value: focuserCelsius === undefined ? unknown : `${focuserCelsius.toFixed(0)} °C` },
        ]}
      />

      {stopped === undefined ? <Statement size="instruction">Walk in</Statement> : null}
    </LaunchStep>
  )
}
