import { describe, expect, it } from 'vitest'
import {
  branchFilter,
  eventIdOf,
  kinds,
  rigId,
  sourceId,
  subjectOf,
  type AssessKind,
  type Draft,
  type FactKind,
  type Kind,
  type RigEvent,
  type SameMembers,
} from '@vela/rig-events'
import { stateDraft } from './samples.ts'

describe('the registry', () => {
  it('splits every kind into the fact branch or the assess branch', () => {
    const facts: FactKind[] = ['cria.state', 'cria.exchange', 'cria.image', 'cria.stream', 'frame', 'solve', 'session', 'gap']
    const assessments: AssessKind[] = ['mount-position', 'pointing-fix']

    expect(new Set<Kind>([...facts, ...assessments])).toEqual(new Set(Object.keys(kinds)))

    for (const kind of facts) expect(kinds[kind].branch).toBe('fact')

    for (const kind of assessments) expect(kinds[kind].branch).toBe('assess')
  })

  it('lets only the model publish an assessment', () => {
    expect(kinds['mount-position'].producers).toEqual(['model'])
    expect(kinds['pointing-fix'].producers).toEqual(['model'])
  })

  it('derives the subject from the branch and the kind', () => {
    const rig = rigId('test-rig')

    expect(subjectOf(rig, 'cria.state')).toBe('rig.v1.test-rig.fact.cria.state')
    expect(subjectOf(rig, 'pointing-fix')).toBe('rig.v1.test-rig.assess.pointing-fix')
    expect(branchFilter('fact')).toBe('rig.v1.*.fact.>')
    expect(branchFilter('assess')).toBe('rig.v1.*.assess.>')
  })
})

describe('the exhaustiveness check', () => {
  it('holds when two sets of kinds are the same', () => {
    const same: SameMembers<'a' | 'b', 'b' | 'a'> = true

    expect(same).toBe(true)
  })

  it('fails the build when a kind is in one set only', () => {
    // @ts-expect-error a kind the event union lacks
    const missingBody: SameMembers<'a' | 'b', 'a'> = true
    // @ts-expect-error a body the registry lacks
    const missingKind: SameMembers<'a', 'a' | 'b'> = true

    expect([missingBody, missingKind]).toEqual([true, true])
  })

  it('fails the build when the registry gains a kind the event union has no envelope for', () => {
    const extended = { ...kinds, extra: { branch: 'fact', producers: ['vela'] } } as const
    // @ts-expect-error 'extra' has no envelope in RigEvent
    const unmatched: SameMembers<keyof typeof extended, RigEvent['kind']> = true

    expect(unmatched).toBe(true)
  })
})

describe('event ids', () => {
  it('gives the same fact the same id and different facts different ids', () => {
    const first = stateDraft(1)
    const second = stateDraft(2)

    expect(eventIdOf(first)).toBe(eventIdOf(stateDraft(1)))
    expect(eventIdOf(first)).not.toBe(eventIdOf(second))
  })

  it('keeps the snapshots of two sources apart when both number them alike', () => {
    const imported: Draft = { ...stateDraft(1), source: sourceId('import:indi-recording') }

    expect(eventIdOf(imported)).not.toBe(eventIdOf(stateDraft(1)))
  })

  it('keeps live and rebuilt snapshots of one sequence apart', () => {
    const live: Draft = { ...stateDraft(1), body: { ...stateDraft(1).body, freshness: 'observed' } }

    expect(eventIdOf(live)).not.toBe(eventIdOf(stateDraft(1)))
  })
})
