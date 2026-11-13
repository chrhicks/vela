import { StreamPosition } from '../../state/entry.ts'
import { describe, expect, it } from 'vitest'
import { fakeCamera } from '../testing/camera.ts'
import { startedAt, wire } from '../testing/entries.ts'
import { decodeConfig } from '../config.ts'
import { AutofocusSettings } from '../settings.ts'
import { bestFocus, makeAutofocus, type Sample } from './autofocus.ts'

const sweep = (rows: ReadonlyArray<readonly [number, number, number]>): Sample[] => rows.map(([position, hfd, stars], index) => ({ frame: index + 1, position, hfd: stars > 0 ? hfd : undefined, stars }))

describe('the best focus of a sweep', () => {
  it('fits the lowest sample and its two neighbours (recorded 10-31 run, 50 steps)', () => {
    const samples = sweep([
      [32674, 4.2, 144],
      [32624, 4.2, 153],
      [32574, 3.9, 175],
      [32524, 2.4, 281],
      [32474, 3.7, 161],
      [32424, 6.9, 55],
      [32374, 11.3, 26],
      [32324, 14.7, 8],
      [32274, 7.7, 7],
    ])

    expect(bestFocus(samples, 10)).toEqual({ position: 32522, how: 'fit' })
  })

  it('ignores star sizes measured on few stars, and takes the lowest when a neighbour has too few (recorded 10-31 run, 100 steps)', () => {
    const samples = sweep([
      [33183, 21.5, 0],
      [33083, 3.5, 1],
      [32983, 4.7, 3],
      [32883, 3.4, 4],
      [32783, 3.5, 4],
      [32683, 12.3, 13],
      [32583, 5.3, 125],
      [32483, 3.2, 218],
      [32383, 10.9, 20],
    ])

    expect(bestFocus(samples, 10)).toEqual({ position: 32483, how: 'lowest' })
  })

  it('says when the lowest sample is at the end of the sweep', () => {
    expect(bestFocus(sweep([[1200, 6, 50], [1150, 5, 60], [1100, 4, 70]]), 10)).toEqual({ position: 1100, how: 'edge' })
  })

  it('has no best focus, at the default star count, for a sweep of a dark frame whose stars are hot pixels and noise', () => {
    const { minStars } = decodeConfig(AutofocusSettings, {})
    const dark = sweep([[32762, 2.1, 12], [32712, 1.9, 10], [32662, 2.5, 4], [32612, 2, 8], [32562, 2.5, 5], [32512, 1.9, 9], [32462, 2, 11], [32412, 2.1, 9], [32362, 2.3, 9]])

    expect(bestFocus(dark, minStars)).toBeUndefined()
  })

  it('has no best focus when the most stars any frame showed are noise', () => {
    expect(bestFocus(sweep([[32577, 1.2, 1], [32527, 1.8, 2], [32477, 1.8, 2], [32427, 1.6, 2], [32377, 2.3, 4]]), 10)).toBeUndefined()
  })

  it('has no best focus when no frame showed stars', () => {
    expect(bestFocus(sweep([[1100, 21.5, 0], [1050, 21.5, 0], [1000, 21.5, 0]]), 10)).toBeUndefined()
  })
})

async function scriptedSweep(stars: number, refuseMoves?: string, missFrame = 0) {
  const published: Array<{ kind: string; body: Record<string, unknown> }> = []
  const focus = { autofocus: undefined as ReturnType<typeof makeAutofocus> | undefined }
  const camera = fakeCamera({
    onEvent: event => {
      if (event.kind === 'exposed') {
        const file = String(event.body['file'])
        const frame = Number(event.body['frame'])

        const position = focus.autofocus?.view().positions[frame - 1] ?? 1010

        if (frame === missFrame) focus.autofocus?.measured({ file, result: 'refused', reason: 'measure is not set up in the rig file' })
        else focus.autofocus?.measured({ file, result: 'measured', solve: undefined, stars: { measured: true, hfd: 2 + ((position - 1010) / 50) ** 2, count: stars }, header: {} })
      }
      focus.autofocus?.observe({ seq: StreamPosition.make(0), kind: `vela.run.${event.kind}`, at: startedAt, body: { run: event.run, ...event.body } })
    },
  })
  const moves: number[] = []
  let at = startedAt + 1000

  camera.feed(wire((at += 1), 'def', 'primary', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 1000 }, 'Ok', 'in', { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } }))

  const autofocus = makeAutofocus({
    picture: camera.picture,
    sender: {
      send: command => {
        if (command.property === 'ABS_FOCUS_POSITION') moves.push(Number(command.values['FOCUS_ABSOLUTE_POSITION']))
        return camera.sender.send(command)
      },
    },
    capture: camera.capture,
    publish: (kind, body) => {
      published.push({ kind, body: { ...body } })
      focus.autofocus?.observe({ seq: StreamPosition.make(0), kind: `vela.focus.${kind}`, at: (at += 1), body })
    },
    settings: { focuser: 'primary', camera: 'primary', minStars: 10 },
  })

  focus.autofocus = autofocus
  if (refuseMoves !== undefined) camera.script.refuse.set('ABS_FOCUS_POSITION', refuseMoves)
  expect(autofocus.start({ step: 50, samples: 5, exposureSeconds: 0.01 })).toEqual({ ok: true })

  await new Promise<void>(resolve => {
    const check = setInterval(() => {
      autofocus.observe({ seq: StreamPosition.make(0), kind: 'tick', at, body: {} })
      if (autofocus.view().problem !== undefined) void camera.capture.stop()
      if (autofocus.view().ended !== undefined) {
        clearInterval(check)
        resolve()
      }
    }, 5)
  })

  return { autofocus, moves, published }
}

describe('an autofocus run on a scripted camera and focuser', () => {
  it('sweeps down from above, lands on the best focus from above, and takes a check frame there', async () => {
    const { autofocus, moves, published } = await scriptedSweep(200)

    expect(moves).toEqual([1150, 1100, 1050, 1000, 950, 900, 1150, 1010])
    expect(autofocus.view()).toMatchObject({ positions: [1100, 1050, 1000, 950, 900], best: { position: 1010, how: 'fit' }, check: { position: 1010, hfd: 2 }, ended: 'done' })
    expect(published.map(entry => entry.kind)).toEqual(['started', 'sample', 'sample', 'sample', 'sample', 'sample', 'best', 'sample'])
  })

  it('goes on to the best focus without a sample the rig program did not measure', async () => {
    const { autofocus } = await scriptedSweep(200, undefined, 5)

    expect(autofocus.view()).toMatchObject({ best: { position: 1010 }, ended: 'done' })
    expect(autofocus.view().samples.find(sample => sample.frame === 5)).toMatchObject({ hfd: undefined, stars: 0, missed: 'the rig program did not measure it: measure is not set up in the rig file' })
  })

  it('puts the focuser back where it started, from above, when no frame shows enough stars', async () => {
    const { autofocus, moves, published } = await scriptedSweep(3)

    expect(moves).toEqual([1150, 1100, 1050, 1000, 950, 900, 1150, 1000])
    expect(autofocus.view()).toMatchObject({ best: undefined, check: undefined, ended: 'refused' })
    expect(published.map(entry => entry.kind)).toEqual(['started', 'sample', 'sample', 'sample', 'sample', 'sample'])
  })

  it('waits with the reason on the page when a focuser move is refused, until Stop', async () => {
    const { autofocus, moves } = await scriptedSweep(200, 'the focuser is not connected')

    expect(moves).toEqual([1150])
    expect(autofocus.view()).toMatchObject({ problem: 'focuser move to 1150: the focuser is not connected', ended: 'stopped' })
  })

  it('refuses a sweep that would leave the focuser travel', () => {
    const camera = fakeCamera()

    camera.feed(wire(startedAt + 1000, 'def', 'primary', 'ABS_FOCUS_POSITION', { FOCUS_ABSOLUTE_POSITION: 100 }, 'Ok', 'in', { FOCUS_ABSOLUTE_POSITION: { min: 0, max: 60000 } }))

    const autofocus = makeAutofocus({ picture: camera.picture, sender: camera.sender, capture: camera.capture, publish: () => undefined, settings: { focuser: 'primary', camera: 'primary', minStars: 10 } })

    expect(autofocus.start({ step: 50, samples: 9, exposureSeconds: 1 })).toEqual({ ok: false, reason: "the sweep -100 to 350 leaves the focuser's travel, 0 to 60000" })
  })
})
