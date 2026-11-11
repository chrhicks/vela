import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { ActionLink } from '../../../components/ActionLink.tsx'
import { Caption } from '../../../components/Caption.tsx'
import { Field } from '../../../components/Field.tsx'
import { Page } from '../../../components/Page.tsx'
import { PageHeader } from '../../../components/PageHeader.tsx'
import styles from './ReadyView.module.css'
import { matching } from './search.ts'
import { ready, targets } from './stub.ts'
import { TargetList } from './TargetList.tsx'
import { TargetPanel } from './TargetPanel.tsx'

export function ReadyView() {
  const [typed, setTyped] = useState('')
  const [search] = useSearchParams()

  const found = matching(targets, typed)
  const asked = targets.find(target => target.id === search.get('target'))
  const shown = asked ?? found[0]

  return (
    <Page width="wide">
      <PageHeader title="Ready" facts={ready.facts}>
        <ActionLink to="/controls">Controls</ActionLink>
      </PageHeader>

      <div className={styles.picker} data-opened={asked !== undefined}>
        <div className={styles.browse}>
          <div className={styles.find}>
            <Caption>{typed === '' ? 'Best placed now' : 'Matches'}</Caption>

            <div className={styles.search}>
              <Field name="Search" kind="search" value={typed} onChange={setTyped} />
            </div>
          </div>

          <TargetList targets={found} chosen={shown?.id} />
        </div>

        {shown === undefined ? null : (
          <div className={styles.chosen}>
            <TargetPanel key={shown.id} target={shown} />
          </div>
        )}
      </div>
    </Page>
  )
}
