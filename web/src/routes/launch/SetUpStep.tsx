import { useState } from 'react'

import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Checklist } from './Checklist.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { checklist, rigPc } from './stub.ts'

export function SetUpStep() {
  const [done, setDone] = useState<ReadonlySet<string>>(new Set())

  function toggle(item: string) {
    const next = new Set(done)

    if (!next.delete(item)) next.add(item)

    setDone(next)
  }

  return (
    <LaunchStep
      step={1}
      title="Set up"
      facts={[`${done.size} of ${checklist.length}`]}
      action={<PillLink to="/launch/bring-up">Next</PillLink>}
    >
      <Checklist items={checklist} done={done} onToggle={toggle} />

      <Readings rows={[rigPc]} />
    </LaunchStep>
  )
}
