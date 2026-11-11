import type { ReactNode } from 'react'

import { Readings } from '../../components/Readings.tsx'
import styles from './Area.module.css'
import { areas, type AreaId } from './stub.ts'

interface AreaProps {
  readonly id: AreaId
  readonly children: ReactNode
}

export function Area({ id, children }: AreaProps) {
  const area = areas[id]

  return (
    <section className={styles.area} data-area={id}>
      <Readings heading={area.heading} rows={area.readings} />

      <div className={styles.actions}>{children}</div>
    </section>
  )
}

interface ActionRowProps {
  readonly label?: string
  readonly children: ReactNode
}

export function ActionRow({ label, children }: ActionRowProps) {
  return (
    <div className={styles.row}>
      {label === undefined ? null : <span className={styles.label}>{label}</span>}

      {children}
    </div>
  )
}
