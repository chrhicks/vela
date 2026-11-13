import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { useLocalNow } from '../../rig/clock.ts'
import { useLink } from '../../rig/store.ts'
import { useRigProgramUp } from '../../rig/use-rig-program-up.ts'
import { Checklist } from './Checklist.tsx'
import { checklist } from './checklist.ts'
import { LaunchStep } from './LaunchStep.tsx'
import { useChecklist } from './use-checklist.ts'

const secondsBetweenRedraws = 1

function booting(since: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - since) / 1000))

  return `Booting ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function SetUpStep() {
  const { done, pcPressedAt, toggle } = useChecklist(useLink().night)
  const rigUp = useRigProgramUp()
  const now = useLocalNow(secondsBetweenRedraws * 1000)
  const rigPc = rigUp ? 'Up' : pcPressedAt === undefined ? 'Off' : booting(pcPressedAt, now)

  return (
    <LaunchStep step={1} title="Set up" facts={[`${done.size} of ${checklist.length}`]} action={<PillLink to="/launch/bring-up">Next</PillLink>}>
      <Checklist items={checklist} done={done} onToggle={toggle} />

      <Readings rows={[{ label: 'Rig PC', value: rigPc }]} />
    </LaunchStep>
  )
}
