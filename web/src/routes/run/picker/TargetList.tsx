import { Link } from 'react-router'

import type { TargetFound } from '../../../../../state/targets.ts'
import { aboveLineOf, altitudeOf, degrees, frameShareOf, isUp, lineWordsOf, moonOf } from './words.ts'
import styles from './TargetList.module.css'

interface TargetListProps {
  readonly targets: ReadonlyArray<TargetFound>
  readonly chosen: string | undefined
}

export const addressOf = (id: string) => `/?target=${encodeURIComponent(id)}`

export function TargetList({ targets, chosen }: TargetListProps) {
  const placed = targets.flatMap(target => (target.placement === null ? [] : [target.placement]))
  const flatLine = placed.length > 0 && placed.every(placement => placement.lineSource === 'up-line') ? placed[0]?.lineDegrees : undefined

  return (
    <div className={styles.list}>
      <div className={`${styles.row} ${styles.head}`} aria-hidden="true">
        <span>Target</span>
        <span>Alt now</span>
        <span>{flatLine === undefined ? 'Up until' : `Above ${degrees(flatLine)} until`}</span>
        <span>From moon</span>
        <span>Dual band</span>
        <span>Of frame</span>
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

          <span className={styles.detail} title={lineWordsOf(target.placement)}>
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

          <span className={styles.detail}>
            <span className={styles.prefix}>Frame </span>
            {frameShareOf(target.sizeArcminutes)}
          </span>
        </Link>
      ))}
    </div>
  )
}
