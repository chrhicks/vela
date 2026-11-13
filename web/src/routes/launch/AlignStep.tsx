import { useNavigate } from 'react-router'

import { instruction, trend, type Instruction, type Trend } from '../../../../state/alignment.ts'
import { cutShort, isRunning } from '../../../../state/operations.ts'
import { Chart } from '../../components/Chart.tsx'
import { CommandPill } from '../../components/CommandPill.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Readout } from '../../components/Readout.tsx'
import { Statement } from '../../components/Statement.tsx'
import { niceTicks } from '../../components/ticks.ts'
import { useLocalNow } from '../../rig/clock.ts'
import { serviceNow } from '../../rig/service-clock.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { LaunchStep } from './LaunchStep.tsx'
import { StoppedAlert } from './StoppedAlert.tsx'
import { useChecklist } from './use-checklist.ts'

const secondsBetweenRedraws = 1

const instructionWords: Readonly<Record<Instruction, string>> = {
  measuring: 'Measuring',
  good: 'Good',
  raise: 'Raise',
  lower: 'Lower',
  turnEast: 'Turn east',
  turnWest: 'Turn west',
}

const trendWords: Readonly<Record<Trend, string>> = { falling: 'FALLING', rising: 'RISING', steady: 'STEADY' }

const arcmin = (value: number | undefined) => (value === undefined ? '—' : `${Math.abs(value).toFixed(1)}′`)

export function AlignStep() {
  const navigate = useNavigate()
  const link = useLink()
  const operation = useRig(rig => rig.operations.align)
  const aligning = isRunning(operation)
  const stopped = cutShort(operation)
  const { errors, lastFrame, lastFrameAt } = useRig(rig => rig.alignment)
  const filterOut = useChecklist(link.night).done.has('Filter out')
  const now = serviceNow(link, useLocalNow(secondsBetweenRedraws * 1000))
  const goodArcmin = link.launch?.alignGoodArcmin ?? 0
  const latest = errors.at(-1)
  const said = instruction(latest, goodArcmin)
  const totals = errors.map(error => ({ x: error.frame, y: error.totalArcmin }))
  const ago = lastFrameAt === undefined || now === undefined ? undefined : `${Math.max(0, Math.round((now - lastFrameAt) / 1000))} s ago`
  const facts = [lastFrame === undefined ? 'Not started' : `Frame ${lastFrame}`, ...(ago === undefined ? [] : [ago]), ...(filterOut ? ['Filter out'] : [])]
  const shownTrend = trend(errors)

  const action = aligning ? (
    <CommandPill request={{ command: 'finishAlignment' }} onCarriedOut={() => navigate('/launch/filter')}>
      Done
    </CommandPill>
  ) : (
    <CommandPill request={{ command: 'startAlignment' }}>Start</CommandPill>
  )

  return (
    <LaunchStep step={3} title="Polar align" facts={facts} action={action}>
      {stopped === undefined ? null : <StoppedAlert what="Alignment" ended={stopped} />}

      <Readout
        items={[
          { label: 'Alt', value: arcmin(latest?.altitudeArcmin) },
          { label: 'Az', value: arcmin(latest?.azimuthArcmin) },
        ]}
      />

      <Statement size="instruction">{aligning || latest !== undefined ? instructionWords[said] : 'Tap start'}</Statement>

      <Readings
        rows={[
          { label: 'Total', value: arcmin(latest?.totalArcmin) },
          said === 'good' ? { label: 'Good under', value: `${goodArcmin}′` } : { label: 'Trend', value: shownTrend === undefined ? '—' : trendWords[shownTrend] },
        ]}
      />

      <Chart
        title="Total error ′"
        lines={[totals]}
        yTicks={niceTicks([0, ...totals.map(point => point.y)])}
        xLabels={[`Frame ${totals[0]?.x ?? 3}`, `Frame ${totals.at(-1)?.x ?? 3}`]}
        band={{ from: 0, to: goodArcmin }}
      />
    </LaunchStep>
  )
}
