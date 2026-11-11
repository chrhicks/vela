import { PillLink } from '../../components/PillLink.tsx'
import { Readings } from '../../components/Readings.tsx'
import { Statement } from '../../components/Statement.tsx'
import { LaunchStep } from './LaunchStep.tsx'
import { rigReady } from './stub.ts'
import { useFilterAnswer } from './useFilterAnswer.ts'

export function ReadyStep() {
  const filter = useFilterAnswer()

  return (
    <LaunchStep step={6} title="Rig ready" facts={[rigReady.at]} action={<PillLink to="/">Pick target</PillLink>}>
      <Statement size="verdict">Go inside</Statement>

      <Readings rows={[...rigReady.summary, { label: 'Filter', value: filter.toUpperCase() }]} />
    </LaunchStep>
  )
}
