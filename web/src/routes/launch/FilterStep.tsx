import { Facts } from '../../components/Facts.tsx'
import { PillLink } from '../../components/PillLink.tsx'
import { Statement } from '../../components/Statement.tsx'
import styles from './FilterStep.module.css'
import { LaunchStep } from './LaunchStep.tsx'

export function FilterStep() {
  return (
    <LaunchStep step={4} title="Filter" facts={['Dual band']}>
      <Statement size="instruction">Filter tonight?</Statement>

      <div className={styles.answers}>
        <PillLink to="/launch/focus?filter=in">In</PillLink>
        <PillLink to="/launch/focus?filter=out">Out</PillLink>
      </div>

      <Facts items={['Insert it first', 'Then tap in']} />
    </LaunchStep>
  )
}
