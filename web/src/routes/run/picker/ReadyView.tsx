import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { ActionLink } from '../../../components/ActionLink.tsx'
import { Caption } from '../../../components/Caption.tsx'
import { Field } from '../../../components/Field.tsx'
import { Page } from '../../../components/Page.tsx'
import { PageHeader } from '../../../components/PageHeader.tsx'
import { Statement } from '../../../components/Statement.tsx'
import { clockTime, useLocalNow } from '../../../rig/clock.ts'
import { useRig } from '../../../rig/store.ts'
import { bestPlacedTargets, findTargets, skyTonight } from '../../../rig/targets.ts'
import { useAsked } from '../../../rig/use-asked.ts'
import styles from './ReadyView.module.css'
import { TargetList } from './TargetList.tsx'
import { TargetPanel } from './TargetPanel.tsx'
import { moonWords } from './words.ts'

const refreshMilliseconds = 60_000

export function ReadyView() {
  const [typed, setTyped] = useState('')
  const [search] = useSearchParams()
  const minute = Math.floor(useLocalNow(refreshMilliseconds) / refreshMilliseconds)
  const text = typed.trim()

  const listing = useAsked(() => (text === '' ? bestPlacedTargets() : findTargets(text)), text, minute)
  const sky = useAsked(skyTonight, 'sky', minute)
  const focus = useRig(rig => rig.operations.focus)
  const filter = useRig(rig => rig.operations.filter)

  const targets = listing?.status === 'listed' ? listing.targets : []
  const tonight = sky?.status === 'read' ? sky.sky : null
  const shown = search.get('target') ?? targets[0]?.id

  const facts = [
    ...(focus?.status === 'ended' ? [`Rig set ${clockTime(focus.endedAt)}`] : []),
    ...(filter === undefined ? [] : [`Filter ${filter}`]),
    ...(tonight === null ? [] : [...(tonight.dark === null ? [] : [`Dark until ${clockTime(tonight.dark.until)}`]), moonWords(tonight)]),
  ]

  return (
    <Page width="wide">
      <PageHeader title="Ready" facts={facts}>
        <ActionLink to="/controls">Controls</ActionLink>
      </PageHeader>

      <div className={styles.picker} data-opened={search.has('target')}>
        <div className={styles.browse}>
          <div className={styles.find}>
            <Caption>{text === '' ? 'Best placed now' : 'Matches'}</Caption>

            <div className={styles.search}>
              <Field name="Search" kind="search" value={typed} onChange={setTyped} />
            </div>
          </div>

          {listing?.status === 'unreachable' ? <Statement size="instruction">Vela did not answer</Statement> : null}
          {listing?.status === 'listed' && targets.length === 0 ? <Statement size="instruction">{text === '' ? 'Nothing listed yet: the mount has not reported the site' : 'No target by that name'}</Statement> : null}

          <TargetList targets={targets} chosen={shown} />
        </div>

        {shown === undefined ? null : (
          <div className={styles.chosen}>
            <TargetPanel key={shown} id={shown} darkUntil={tonight?.dark?.until} refreshed={minute} />
          </div>
        )}
      </div>
    </Page>
  )
}
