import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Statement } from '../../components/Statement.tsx'
import { clockTime } from '../../rig/clock.ts'
import { useRigProgramUp } from '../../rig/use-rig-program-up.ts'
import { useLink, useRig } from '../../rig/store.ts'
import { checklist } from './checklist.ts'
import { LaunchStep } from './LaunchStep.tsx'
import { liveReady } from './live.ts'
import { useChecklist } from './use-checklist.ts'

const unknown = '—'

export function ReadyStep() {
  const link = useLink()
  const rig = useRig(state => state)
  const ticked = useChecklist(link.night)
  const ready = liveReady(rig, useRigProgramUp(), { done: checklist.filter(item => ticked.done.has(item)).length, of: checklist.length }, link.launch?.alignGoodArcmin)

  return (
    <LaunchStep step={6} title="Rig ready" facts={ready.focusedAt === undefined ? [] : [clockTime(ready.focusedAt)]} action={<PillLink to="/?pick">Pick target</PillLink>}>
      <Statement size="verdict">{ready.allGood ? 'Go inside' : 'Not ready'}</Statement>

      <Readings
        rows={[
          { label: 'Checklist', value: `${ready.checklist.done} OF ${ready.checklist.of}`, attention: ready.checklist.done !== ready.checklist.of },
          { label: 'Devices', value: `${ready.devices.set} OF ${ready.devices.of}`, attention: ready.devices.set !== ready.devices.of },
          { label: 'Align', value: ready.alignArcmin === undefined ? unknown : `${ready.alignArcmin.toFixed(1)}′`, attention: !ready.alignGood },
          { label: 'Filter', value: ready.filter?.toUpperCase() ?? unknown, attention: ready.filter === undefined },
          { label: 'Focus', value: ready.focusPixels === undefined ? unknown : `${ready.focusPixels.toFixed(1)} px`, attention: !ready.focusFound },
        ]}
      />
    </LaunchStep>
  )
}
