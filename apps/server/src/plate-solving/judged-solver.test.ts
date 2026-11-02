import { expect, it } from 'vitest'
import type { AstapSolution } from '@vela/rig-astap'
import { astapReturning, falseSolve, fieldHeightDegreesFor, goodSolve } from './false-solve.js'
import { describeRejection, judgedSolver, type MonoFrame } from './judged-solver.js'

const frame: MonoFrame = { width: 100, height: 80, pixels: new Float64Array(8000), capturedAt: '2026-09-07T04:00:00Z' }

const claimed = { raDegrees: 10, decDegrees: 20 }

const signal = new AbortController().signal

const solve = (solution: AstapSolution, purpose: 'framing' | 'alignment' = 'framing') =>
  judgedSolver(astapReturning(solution), fieldHeightDegreesFor(frame.height), purpose).solve(frame, claimed, claimed, signal)

it('returns the position and plate of an accepted solve, stamped with the frame time', async () => {
  const solution = goodSolve(claimed, frame)

  if (solution.status !== 'solved') throw new Error('Expected fixture')
  await expect(solve(solution)).resolves.toEqual({ status: 'solved', capturedAt: frame.capturedAt, wcs: solution.wcs, ...solution.centre })
})

it.each(['framing', 'alignment'] as const)('does not use the audit\'s false solve for %s', async purpose => {
  const result = await solve(falseSolve(claimed, frame), purpose)

  expect(result).toMatchObject({ status: 'no-solution', reasons: ['scale', 'parity', 'off-hint'], offHintDegrees: expect.closeTo(100.9, 3) })
})

it('turns ASTAP finding nothing into a reason, not an error', async () => {
  await expect(solve({ status: 'no-solution', reason: 'too-few-stars', radiusDegrees: 10 })).resolves.toEqual({ status: 'no-solution', reasons: ['few-stars'], measured: null })
  await expect(solve({ status: 'no-solution', reason: 'no-match', radiusDegrees: 180 })).resolves.toEqual({ status: 'no-solution', reasons: ['no-match'], measured: null })
})

it('says in words why a solve was rejected, and how far off the field was', async () => {
  const rejected = await solve(falseSolve(claimed, frame))

  if (rejected.status !== 'no-solution') throw new Error('Expected a rejection')
  expect(describeRejection(rejected)).toBe('the plate scale does not match the optics; the image is mirrored; the field is 100.9 degrees from where the mount points')
  expect(describeRejection({ status: 'no-solution', reasons: ['few-stars'], measured: null })).toBe('too few stars')
})
