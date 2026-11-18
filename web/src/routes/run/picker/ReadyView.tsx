import { useState } from 'react'
import { useSearchParams } from 'react-router'

import { ActionLink } from '../../../components/ActionLink.tsx'
import type { ListOrder, ListShown } from '../../../../../state/targets.ts'
import { Caption } from '../../../components/Caption.tsx'
import { Choices } from '../../../components/Choices.tsx'
import { Field } from '../../../components/Field.tsx'
import { Page } from '../../../components/Page.tsx'
import { PageHeader } from '../../../components/PageHeader.tsx'
import { Statement } from '../../../components/Statement.tsx'
import { clockTime, useLocalNow } from '../../../rig/clock.ts'
import { useRig } from '../../../rig/store.ts'
import { bestPlacedTargets, catalogSize, detailSurveyKept, findTargets, rememberedNow, skyTonight, surveyKept } from '../../../rig/targets.ts'
import { useAsked } from '../../../rig/use-asked.ts'
import styles from './ReadyView.module.css'
import { TargetList } from './TargetList.tsx'
import { TargetPanel } from './TargetPanel.tsx'
import { moonWords } from './words.ts'

const refreshMilliseconds = 60_000

const listedWords: Readonly<Record<ListOrder, string>> = { placed: 'Best placed', largest: 'Largest up' }

export function ReadyView() {
  const [typed, setTyped] = useState('')
  const [show, setShow] = useState<ListShown>('all')
  const [order, setOrder] = useState<ListOrder>('placed')
  const [search] = useSearchParams()
  const now = useLocalNow(refreshMilliseconds)
  const minute = Math.floor(now / refreshMilliseconds)
  const text = typed.trim()

  const listing = useAsked(() => (text === '' ? bestPlacedTargets({ show, order }) : findTargets(text)), text === '' ? `${show} ${order}` : `typed ${text}`, minute)
  const sky = useAsked(skyTonight, 'sky', minute)
  const recalled = useAsked(rememberedNow, 'remembered', minute)
  const survey = useAsked(surveyKept, 'survey', 0)
  const detailSurvey = useAsked(detailSurveyKept, 'detail-survey', 0)
  const catalog = useAsked(catalogSize, 'catalog', 0)
  const focus = useRig(rig => rig.operations.focus)
  const filter = useRig(rig => rig.operations.filter)

  const targets = listing?.status === 'listed' ? listing.targets : []
  const tonight = sky?.status === 'read' ? sky.sky : null
  const remembered = recalled?.status === 'recalled' ? recalled.remembered : undefined
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
            <Caption>{text !== '' ? 'Matches' : tonight?.dark != null && now < tonight.dark.from ? `${listedWords[order]} at ${clockTime(tonight.dark.from)}` : `${listedWords[order]} now`}</Caption>

            <div className={styles.search}>
              <Field name="Search" kind="search" value={typed} onChange={setTyped} />
            </div>
          </div>

          {text !== '' ? null : (
            <div className={styles.narrow}>
              <Choices
                name="Show"
                choices={[
                  { value: 'all', label: 'All' },
                  { value: 'dual-band', label: 'Dual band' },
                ]}
                chosen={show}
                onChoose={setShow}
              />

              <Choices
                name="Order"
                choices={[
                  { value: 'placed', label: 'Best placed' },
                  { value: 'largest', label: 'Largest' },
                ]}
                chosen={order}
                onChoose={setOrder}
              />
            </div>
          )}

          {listing?.status === 'unreachable' ? <Statement size="instruction">Vela did not answer</Statement> : null}
          {catalog?.targets === 0 ? (
            <Statement size="instruction">No target catalog on this machine: only typed coordinates can be found</Statement>
          ) : listing?.status === 'listed' && targets.length === 0 ? (
            <Statement size="instruction">{text === '' ? 'Nothing listed yet: the mount has not reported the site' : 'No target by that name'}</Statement>
          ) : null}

          <TargetList targets={targets} chosen={shown} />
        </div>

        {shown === undefined || recalled === undefined ? null : (
          <div className={styles.chosen}>
            <TargetPanel key={shown} id={shown} darkUntil={tonight?.dark?.until} lastLight={remembered?.lastLight ?? null} cameraAngleDegrees={remembered?.cameraAngleDegrees ?? null} survey={survey ?? null} detailSurvey={detailSurvey ?? null} refreshed={minute} />
          </div>
        )}
      </div>
    </Page>
  )
}
