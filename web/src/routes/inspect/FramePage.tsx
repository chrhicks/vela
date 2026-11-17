import { useParams } from 'react-router'

import { framesOf } from '../../../../state/first-frames.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Statement } from '../../components/Statement.tsx'
import { clockSeconds } from '../../rig/clock.ts'
import { useRig } from '../../rig/store.ts'
import { FrameInspector } from './FrameInspector.tsx'

export function FramePage() {
  const asked = Number.parseInt(useParams().number ?? '', 10)
  const run = useRig(rig => rig.run)
  const kept = useRig(rig => rig.frames)
  const ours = run === undefined ? [] : framesOf(run, kept)
  const frame = ours[asked - 1]
  const measured = frame?.measurements

  const facts =
    run === undefined || frame === undefined
      ? []
      : [
          run.object,
          `${run.exposureSeconds} s`,
          clockSeconds(frame.keptAt),
          ...(measured?.hfdPixels == null ? [] : [`HFD ${measured.hfdPixels.toFixed(2)}`]),
          ...(measured?.stars == null ? [] : [`${measured.stars} stars`]),
        ]

  return (
    <Page width="wide">
      <PageHeader title={`Frame ${Number.isNaN(asked) ? '' : asked}`} facts={facts}>
        {frame !== undefined && asked > 1 ? <ActionLink to={`/frame/${asked - 1}`}>← {asked - 1}</ActionLink> : null}
        {frame !== undefined && asked < ours.length ? <ActionLink to={`/frame/${asked + 1}`}>{asked + 1} →</ActionLink> : null}
        <ActionLink to="/stack">Stack</ActionLink>
        <ActionLink to="/">Close</ActionLink>
      </PageHeader>

      {frame === undefined ? <Statement size="instruction">{ours.length === 0 ? 'No frames kept in this run yet' : `This run has frames 1 to ${ours.length}`}</Statement> : <FrameInspector key={frame.file} frame={frame} />}
    </Page>
  )
}
