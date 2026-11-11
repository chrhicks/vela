import type { ReactNode } from 'react'

import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import styles from './LaunchStep.module.css'
import { stepCount } from './stub.ts'

interface LaunchStepProps {
  readonly step: number
  readonly title: string
  readonly facts: ReadonlyArray<string>
  readonly action?: ReactNode
  readonly children: ReactNode
}

export function LaunchStep({ step, title, facts, action, children }: LaunchStepProps) {
  return (
    <Page width="phone">
      <PageHeader title={title} facts={facts} />

      <div className={styles.body}>{children}</div>

      <footer className={styles.footer}>
        <span className={styles.step}>
          Step {step} of {stepCount}
        </span>

        {action}
      </footer>
    </Page>
  )
}
