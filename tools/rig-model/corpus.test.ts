import { describe, expect, it } from 'vitest'
import { epochMs, type SolveBody } from '@vela/rig-events'
import type { SavedImage, Trial, TrialFrame } from '@vela/rig-frames'
import { imageIdOf } from '@vela/rig-testing'
import { caseResults, fewStars, inventoryOf, type Facts, type Solve } from './corpus-inventory.ts'
import { reportOf } from './corpus-report.ts'

const at = Date.UTC(2026, 9, 20, 3, 0, 0)

const arcsec = 1 / 3600

const wcsWith = (scale: number, mirrored = false) => ({ width: 6248, height: 4176, referenceX: 3124.5, referenceY: 2088.5, raDegrees: 10, decDegrees: 40, cd: [-scale * arcsec, 0, 0, (mirrored ? 1 : -1) * scale * arcsec] as const })

function frameOf(index: number, options: { onDisk?: boolean; scale?: number; mirrored?: boolean; phase?: TrialFrame['phase']; position?: number } = {}): TrialFrame {
  return {
    line: index + 2,
    phase: options.phase ?? 'adjusting',
    position: options.position ?? 1,
    filename: `adjusting-${index}.fits`,
    fileId: null,
    bytes: 10,
    sha256: `sha-${index}`,
    capturedAt: epochMs(at + index * 60_000),
    capturedAtSource: 'camera',
    width: 6248,
    height: 4176,
    solved: { raDegrees: 10, decDegrees: 40, wcs: wcsWith(options.scale ?? 1.93, options.mirrored) },
    hint: { raDegrees: 10, decDegrees: 40 },
    fieldHeightDegrees: 2.25,
    onDisk: options.onDisk ?? false,
  }
}

const trialOf = (runId: string, frames: readonly TrialFrame[]): Trial => ({ directory: `/trials/${runId}`, runId, rigId: 'test-rig', mode: 'physical', createdAt: epochMs(at), exposureSeconds: 5, outcome: 'finished', frames, readings: [], baselines: 0, measurements: 0 })

const imageOf = (index: number): SavedImage => ({
  id: imageIdOf(index),
  rigId: 'test-rig',
  frameType: 'light',
  capturedAt: epochMs(at),
  capturedAtSource: 'camera',
  receivedAt: epochMs(at),
  savedAt: epochMs(at),
  exposureSeconds: 60,
  width: 6248,
  height: 4176,
  filter: null,
  fitsPath: `/images/${index}.fits`,
  fitsBytes: 10,
})

const solved = (scale: number): Solve => ({ status: 'solved', solverVersion: 'astap-test', solveMs: 10, hint: null, centre: { raDegrees: 10, decDegrees: 40 }, wcs: wcsWith(scale) }) satisfies Omit<Extract<SolveBody, { status: 'solved' }>, 'imageId'>

const facts = (overrides: Partial<Facts>): Facts => ({ trials: [], images: [], digests: new Map(), solves: new Map(), stars: new Map(), utcOffsetMinutes: 0, ...overrides })

const caseOf = (results: ReturnType<typeof caseResults>, id: string) => results.find(result => result.id === id)

describe('solve corpus', () => {
  it('gives a frame its pixels when the file is there and still the journalled bytes, and the reason when it is not', () => {
    const run = trialOf('aaaaaaaa-0000-4000-8000-000000000000', [frameOf(0, { onDisk: true }), frameOf(1, { onDisk: true }), frameOf(2)])

    const entries = inventoryOf(facts({ trials: [run], digests: new Map([['/trials/aaaaaaaa-0000-4000-8000-000000000000/adjusting-0.fits', 'sha-0'], ['/trials/aaaaaaaa-0000-4000-8000-000000000000/adjusting-1.fits', 'other']]) }))

    expect(entries.slice(0, 3).map(entry => entry.pixels)).toEqual([
      { kind: 'file', path: '/trials/aaaaaaaa-0000-4000-8000-000000000000/adjusting-0.fits', sha256: 'sha-0' },
      { kind: 'missing', reason: 'changed-since-journal' },
      { kind: 'missing', reason: 'not-kept' },
    ])
  })

  it('tags the false solve, the option-sensitive frame and the few-star frame, and finds each case from its pixels', () => {
    const false29 = trialOf('eeef34da-0000-4000-8000-000000000000', [frameOf(0, { onDisk: true }), frameOf(1, { onDisk: true, scale: 2.3, mirrored: true })])
    const optionRun = trialOf('0ded133c-0000-4000-8000-000000000000', [frameOf(2, { onDisk: true, phase: 'baseline', position: 2 })])
    const digests = new Map([...false29.frames, ...optionRun.frames].map(frame => [`${frame === optionRun.frames[0] ? optionRun.directory : false29.directory}/${frame.filename}`, frame.sha256]))
    const entries = inventoryOf(facts({ trials: [false29, optionRun], digests, stars: new Map([['sha-1', 29], ['sha-0', fewStars + 1], ['sha-2', fewStars]]) }))
    const tagged = (id: string) => entries.filter(entry => entry.cases.includes(id)).map(entry => entry.id)

    expect(tagged('PS-001')).toEqual(['trial:eeef34da:1'])
    expect(tagged('PS-003')).toEqual(['trial:eeef34da:1'])
    expect(tagged('PS-007')).toEqual(['trial:0ded133c:0'])
    expect(tagged('PS-008')).toEqual(['trial:eeef34da:1', 'trial:0ded133c:0'])
    expect(tagged('PS-015')).toHaveLength(3)
  })

  it('marks a synthetic case as missing: tagged, but with no pixels to prove it', () => {
    const results = caseResults(inventoryOf(facts({})))

    expect(caseOf(results, 'PS-006')).toMatchObject({ entries: 1, withPixels: 0, status: 'missing' })
    expect(caseOf(results, 'PS-001')).toMatchObject({ entries: 0, status: 'missing' })
  })

  it('finds a scale case from a recorded solve even when no pixels were kept', () => {
    const results = caseResults(inventoryOf(facts({ trials: [trialOf('bbbbbbbb-0000-4000-8000-000000000000', [frameOf(0), frameOf(1)])] })))

    expect(caseOf(results, 'PS-023')).toMatchObject({ entries: 2, withPixels: 0, status: 'found' })
    expect(caseOf(results, 'PS-008')).toMatchObject({ status: 'missing' })
  })

  it('reports the median scale and names the mirrored frame, with the solver result for saved images', () => {
    const run = trialOf('eeef34da-0000-4000-8000-000000000000', [frameOf(0), frameOf(1, { scale: 1.95 }), frameOf(2, { scale: 2.3, mirrored: true })])

    const entries = inventoryOf(facts({ trials: [run], images: [imageOf(1)], digests: new Map([['/images/1.fits', 'image-sha']]), solves: new Map([['image-sha', solved(1.9)]]) }))

    const report = reportOf(entries, { solverVersion: 'astap-test', auditUntil: '2026-10-20T03:01:30.000Z' })

    expect(report).toContain("| alignment solves Vela recorded, the audit's set (captured by 2026-10-20T03:01:30.000Z) | 2 | 1.9400 | none |")
    expect(report).toContain('| alignment solves Vela recorded, all | 3 | 1.9500 | trial:eeef34da:2 |')
    expect(report).toContain("| step 4's saved lights, solved by the real ASTAP | 1 | 1.9000 | none |")
    expect(report).toContain('| saved-image | 1 | 1 | none |')
  })
})
