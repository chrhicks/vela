import { seal, type Envelope } from '@vela/rig-events'
import { frame, imageIdOf, solved, syntheticSite } from '@vela/rig-testing'
import { fromMount } from '@vela/rig-sky'
import { home, inOrder, s, session, skyAt, tracking } from '../../../../packages/rig-model/test/support.js'

export function modelFixture() {
  const capture = frame({ image: imageIdOf(1), capturedAt: s(10), exposureSeconds: 20, seenAt: s(31) })
  const solution = solved(imageIdOf(1), fromMount(skyAt(40, 150, new Date(s(20))), 'topocentric', new Date(s(20)), syntheticSite), s(33))

  if (solution.kind !== 'solve') throw new Error('Expected solve fixture')
  const { id: _id, v: _v, ...draft } = solution

  const shadow = seal({ ...draft, kind: 'solve-result', body: {
    frameEventId: capture.id, purpose: 'framing', solve: solution.body,
    verdict: { status: 'accepted', measured: { arcsecPerPixel: 1.08, scaleError: 0, parity: -1, hintOffsetDegrees: 0, stars: null }, unchecked: ['stars'] },
  } } satisfies Omit<Envelope<'solve-result'>, 'v' | 'id'>)

  return { capture, solution, shadow, baseline: inOrder(session(s(-1)), tracking(0, 60, home), capture) }
}
