import { Link } from 'react-router'

import type { Target } from './stub.ts'
import styles from './TargetList.module.css'

interface TargetListProps {
  readonly targets: ReadonlyArray<Target>
  readonly chosen: string | undefined
}

export function TargetList({ targets, chosen }: TargetListProps) {
  return (
    <div className={styles.list}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span>Target</span>
        <span>Alt now</span>
        <span>Above 30° until</span>
        <span>From moon</span>
        <span>Dual band</span>
      </div>

      {targets.map(target => (
        <Link
          key={target.id}
          to={`/?scene=ready&target=${target.id}`}
          className={[styles.row, target.id === chosen ? styles.chosen : '', target.up ? '' : styles.down].join(' ')}
          aria-current={target.id === chosen}
        >
          <span className={styles.name}>
            {target.name} {target.common}
          </span>

          <span className={styles.altitude}>{target.altitude}</span>

          <span className={styles.detail}>
            <span className={styles.prefix}>Until </span>
            {target.until}
          </span>

          <span className={styles.detail}>
            <span className={styles.prefix}>Moon </span>
            {target.fromMoon}
          </span>

          <span className={styles.detail}>
            <span className={styles.prefix}>Dual </span>
            {target.dualBand ? 'Yes' : 'No'}
          </span>
        </Link>
      ))}
    </div>
  )
}
