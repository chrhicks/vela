import { Facts } from '../../components/Facts.tsx'
import { useNavigate } from 'react-router'

import { CommandPill } from '../../components/CommandPill.tsx'
import { Statement } from '../../components/Statement.tsx'
import styles from './FilterStep.module.css'
import { LaunchStep } from './LaunchStep.tsx'

export function FilterStep() {
  const navigate = useNavigate()
  const toFocus = () => navigate('/launch/focus')

  return (
    <LaunchStep step={4} title="Filter" facts={['Dual band']}>
      <Statement size="instruction">Filter tonight?</Statement>

      <div className={styles.answers}>
        <CommandPill request={{ command: 'answerFilter', filter: 'in' }} onCarriedOut={toFocus}>
          In
        </CommandPill>
        <CommandPill request={{ command: 'answerFilter', filter: 'out' }} onCarriedOut={toFocus}>
          Out
        </CommandPill>
      </div>

      <Facts items={['Insert it first', 'Then tap in']} />
    </LaunchStep>
  )
}
