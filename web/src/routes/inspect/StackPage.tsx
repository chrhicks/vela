import { framesOf } from '../../../../state/first-frames.ts'
import { stackCropAddress, stackPictureAddress, stackShapeAddress } from '../../../../state/stack.ts'
import { ActionLink } from '../../components/ActionLink.tsx'
import { Page } from '../../components/Page.tsx'
import { PageHeader } from '../../components/PageHeader.tsx'
import { Statement } from '../../components/Statement.tsx'
import { useLink, useRig } from '../../rig/store.ts'
import { duration } from '../../rig/words.ts'
import { Inspector } from './Inspector.tsx'

export function StackPage() {
  const { night } = useLink()
  const run = useRig(rig => rig.run)
  const kept = useRig(rig => rig.frames)
  const latest = useRig(rig => rig.stack)
  const stack = latest !== undefined && latest.night === night && latest.frames > 0 ? latest : undefined
  const ours = run !== undefined && stack !== undefined && run.sequence === stack.sequence ? run : undefined
  const frames = ours === undefined ? 0 : framesOf(ours, kept).length

  const facts =
    stack === undefined
      ? []
      : [
          ...(ours === undefined ? [stack.sequence] : [ours.object]),
          `${stack.frames} frames`,
          ...(ours === undefined ? [] : [duration(stack.frames * ours.exposureSeconds)]),
          ...(stack.leftOut === 0 ? [] : [`${stack.leftOut} left out`]),
        ]

  return (
    <Page width="wide">
      <PageHeader title="Stack" facts={facts}>
        {frames === 0 ? null : <ActionLink to={`/frame/${frames}`}>Frame {frames}</ActionLink>}
        <ActionLink to="/">Close</ActionLink>
      </PageHeader>

      {stack === undefined ? (
        <Statement size="instruction">No frames stacked tonight yet</Statement>
      ) : (
        <Inspector key={`${stack.night}/${stack.sequence}`} whole="stack" shapeAddress={stackShapeAddress(stack)} wholeAddress={stackPictureAddress(stack)} cropAt={box => stackCropAddress(stack, box)} />
      )}
    </Page>
  )
}
