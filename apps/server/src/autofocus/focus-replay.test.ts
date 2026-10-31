import { describe, expect, it } from 'vitest'
import { chooseFocus, confirmsBest, type FocusSample } from './choice.js'
import { recordedFocusRuns, type RecordedFocusRun } from './fixtures/recorded-focus-runs.js'
import { lowestMeasured, nextInPass, planPass, type PassNext } from './passes.js'

/**
 * Replays autofocus runs recorded on the rig through the pass logic and the estimator. Nothing here
 * moves a focuser or takes a frame: a recorded sample stands in for the exposure at its position.
 * Tonight's three runs are "2026-10-31 run 1" to "run 3"; the other two are from 2026-10-26.
 */

const travel = { min: 1, max: 60000 }

function recorded(label: string) {
  const run = recordedFocusRuns.find(candidate => candidate.label === label)

  if (!run) throw new Error(`No recorded run ${label}`)

  return run
}

function focusSamples(run: RecordedFocusRun): FocusSample[] {
  return run.samples
}

/**
 * Runs the pass logic on a recorded run as one pass. The run's own planned window is the pass, and
 * every position the logic asks for is answered from the recording. Stops, and says so, at a
 * position that was never recorded.
 */
function replayPass(run: RecordedFocusRun) {
  const planned = planPass(run.startPosition, run, travel)
  const taken: FocusSample[] = []
  const asked: number[] = []

  for (;;) {
    const next: PassNext = nextInPass(planned, run.stepSize, travel, taken)

    if (next.kind !== 'sample') return { planned, asked, taken, end: next }
    asked.push(next.position)
    const answer = run.samples.find(sample => sample.position === next.position)

    if (!answer) return { planned, asked, taken, end: next, unrecorded: next.position }
    taken.push(answer)
  }
}

describe('the pass logic on recorded runs', () => {
  it('extends tonight\'s run 1 toward lower HFR and closes on the minimum instead of failing', () => {
    const run = recorded('2026-10-31 run 1')
    const { planned, asked, end, unrecorded } = replayPass(run)

    expect(planned.at(-1)).toBe(32583)
    expect(lowestMeasured(run.samples.filter(sample => planned.includes(sample.position)))!.position).toBe(32583)
    expect(asked.slice(planned.length)).toEqual([32533, 32483])
    expect(unrecorded).toBeUndefined()
    expect(end).toEqual({ kind: 'closed', lowest: 32533 })
  })

  it.each(['2026-10-26 run 1', '2026-10-26 run 2', '2026-10-31 run 2', '2026-10-31 run 3'])(
    'closes %s on its planned window, taking nothing more',
    label => {
      const run = recorded(label)
      const { planned, asked, end } = replayPass(run)

      expect(asked).toEqual(planned)
      expect(asked).toEqual(run.samples.map(sample => sample.position))
      expect(end).toEqual({ kind: 'closed', lowest: lowestMeasured(run.samples)!.position })
    },
  )

  it('runs out of travel instead of stepping past it', () => {
    const run = recorded('2026-10-31 run 1')
    const lowTravel = { min: 32510, max: 60000 }
    const planned = planPass(run.startPosition, run, lowTravel)
    const taken = run.samples.filter(sample => planned.includes(sample.position))

    expect(nextInPass(planned, run.stepSize, lowTravel, taken)).toEqual({ kind: 'sample', position: 32533 })
    expect(nextInPass(planned, run.stepSize, lowTravel, [...taken, run.samples.find(s => s.position === 32533)!])).toEqual({
      kind: 'travel-limit',
      edge: 'low',
      lowest: 32533,
    })
  })
})

describe('the fine-pass estimator on recorded runs', () => {
  it('lands within 25 steps of the measured best on tonight\'s run 3, where the old fit chose 32562', () => {
    const run = recorded('2026-10-31 run 3')
    const choice = chooseFocus(focusSamples(run))

    expect(run.oldFit!.position).toBe(32562)
    expect(choice).not.toBeNull()
    expect(choice!.best).toMatchObject({ position: 32524 })
    expect(Math.abs(choice!.position - 32524)).toBeLessThanOrEqual(25)
  })

  it('keeps every recorded run within one step of its best sample', () => {
    for (const run of recordedFocusRuns) {
      const choice = chooseFocus(focusSamples(run))

      expect(choice, run.label).not.toBeNull()
      expect(Math.abs(choice!.position - choice!.best.position), run.label).toBeLessThanOrEqual(run.stepSize)
    }
  })

  it('falls back to the best measured sample when nothing fits the samples', () => {
    const flat = [32600, 32550, 32500, 32450, 32400, 32350].map((position, index) => ({
      position,
      hfrPixels: 2.5 + [0.1, -0.15, 0.05, 0.2, -0.1, -0.2][index]!,
      detectedStars: 14,
      starHfrs: [2.4, 2.5, 2.6],
    }))

    expect(chooseFocus(flat)).toMatchObject({ source: 'best-sample', fit: null, position: 32350 })
  })

  it('has no choice when no sample measured a star', () => {
    expect(chooseFocus([{ position: 32500, hfrPixels: null, detectedStars: 0, starHfrs: [] }])).toBeNull()
  })

  it('reports the old fit and the new estimator side by side', () => {
    const rows = recordedFocusRuns.map(run => {
      const choice = chooseFocus(focusSamples(run))

      return [
        run.label,
        run.oldFit?.position ?? null,
        choice?.position ?? null,
        choice?.source ?? null,
        choice?.best.position ?? null,
      ]
    })

    expect(rows).toEqual([
      ['2026-10-26 run 1', 32787, 32779, 'fit', 32760],
      ['2026-10-26 run 2', 32783, 32757, 'fit', 32737],
      ['2026-10-31 run 1', null, 32496, 'fit', 32533],
      ['2026-10-31 run 2', 32474, 32517, 'fit', 32483],
      ['2026-10-31 run 3', 32562, 32531, 'fit', 32524],
    ])
  })
})

describe('the confirm check on recorded landings', () => {
  it('would have caught both of tonight\'s bad landings and passed the two good ones from the 26th', () => {
    const verdicts = recordedFocusRuns.flatMap(run => {
      if (!run.confirming) return []
      const best = lowestMeasured(run.samples)!

      return [[run.label, confirmsBest(run.confirming.hfrPixels, best.hfrPixels, 0.1)]]
    })

    expect(verdicts).toEqual([
      ['2026-10-26 run 1', true],
      ['2026-10-26 run 2', true],
      ['2026-10-31 run 2', false],
      ['2026-10-31 run 3', false],
    ])
  })

  it('treats a confirm frame with no stars as unconfirmed', () => {
    expect(confirmsBest(null, 2, 0.1)).toBe(false)
    expect(confirmsBest(2.2, 2, 0.1)).toBe(true)
    expect(confirmsBest(2.2001, 2, 0.1)).toBe(false)
  })
})
