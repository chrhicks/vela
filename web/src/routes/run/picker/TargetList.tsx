import { Link } from 'react-router'

import type { TargetFound } from '../../../../../state/targets.ts'
import { aboveLineOf, altitudeOf, degrees, isUp, moonOf, unknown } from './words.ts'
import styles from './TargetList.module.css'

interface TargetListProps {
  readonly targets: ReadonlyArray<TargetFound>
  readonly chosen: string | undefined
}

export const addressOf = (id: string) => `/?target=${encodeURIComponent(id)}`

export function TargetList({ targets, chosen }: TargetListProps) {
  const line = targets.find(target => target.placement !== null)?.placement?.lineDegrees

  return (
    <div className={styles.list}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span>Target</span>
        <span>Alt now</span>
        <span>Above {line === undefined ? unknown : degrees(line)} until</span>
        <span>From moon</span>
        <span>Dual band</span>
      </div>

      {targets.map(target => (
        <Link
          key={target.id}
          to={addressOf(target.id)}
          className={[styles.row, target.id === chosen ? styles.chosen : '', isUp(target.placement) ? '' : styles.down].join(' ')}
          aria-current={target.id === chosen}
        >
          <span className={styles.name} title={[target.name, target.commonName].filter(Boolean).join(' ')}>
            {target.name} {target.commonName}
          </span>

          <span className={styles.altitude}>{altitudeOf(target.placement)}</span>

          <span className={styles.detail}>
            <span className={styles.prefix}>Until </span>
            {aboveLineOf(target.placement)}
          </span>

          <span className={styles.detail}>
            <span className={styles.prefix}>Moon </span>
            {moonOf(target.placement)}
          </span>

          <span className={styles.detail}>
            <span className={styles.prefix}>Dual </span>
            {target.dualBandHint ? 'Yes' : 'No'}
          </span>
        </Link>
      ))}
    </div>
  )
}
