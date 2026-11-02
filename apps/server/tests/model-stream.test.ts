import { serialize } from 'node:v8'
import { frame, imageIdOf } from '@vela/rig-testing'
import { expect, it } from 'vitest'
import { seal } from '@vela/rig-events'
import { assess } from '@vela/rig-model'
import { inOrder, run, snapshot, session, s } from '../../../packages/rig-model/test/support.js'
import { createStreamModel } from '../src/rig-model/stream.js'
import { modelFixture } from './fixtures/model-stream.js'

it('accepted solve-result shares legacy joins and epochs; rejected verdict cannot establish a fix', () => {
  const { solution, shadow, baseline } = modelFixture()

  if (shadow.kind !== 'solve-result') throw new Error('Expected solve-result')
  const { id: _id, v: _v, ...draft } = shadow

  const rejected = seal({ ...draft, body: { ...shadow.body, verdict: { status: 'rejected', reasons: ['scale'], measured: null } } })
  const legacy = run(inOrder(baseline, solution)).model
  const streamed = run(inOrder(baseline, shadow)).model
  const refused = run(inOrder(baseline, rejected)).model

  expect(assess(legacy).position.state).toBe('known')
  expect(assess(streamed)).toEqual(assess(legacy))
  expect(assess(refused).position.state).toBe('unknown')
  console.log(JSON.stringify({ legacySolve: assess(legacy).position.state, shadowSolveResult: assess(streamed).position.state, rejectedShadowSolveResult: assess(refused).position.state }))
})

it('duplicate stream delivery leaves both assessments and emitted envelopes unchanged', () => {
  const { baseline, shadow } = modelFixture()
  const events = inOrder(baseline, shadow).map((event, index) => ({ ...event, broker: { stream: 'RIG_FACTS', sequence: index + 1 } }))
  const live = createStreamModel()
  const duplicate = createStreamModel()

  expect(events.flatMap(event => duplicate.accept(event).concat(duplicate.accept(event))))
    .toEqual(events.flatMap(event => live.accept(event)))
  expect(duplicate.get(shadow.rig)).toEqual(live.get(shadow.rig))
})

it('checkpointed reducer resumes with the uninterrupted assessments and ignores old sequences', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { checkpointStore } = await import('../src/rig-model/checkpoint.js')
  const directory = await mkdtemp(join(tmpdir(), 'model-checkpoint-'))
  const { baseline, shadow } = modelFixture()
  const events = inOrder(baseline, shadow).map((event, index) => ({ ...event, broker: { stream: 'RIG_FACTS', sequence: index + 1 } }))
  const live = createStreamModel()
  const first = createStreamModel()

  try {
    events.slice(0, 35).forEach(event => {
      live.accept(event)
      first.accept(event).forEach(output => first.published(output))
    })
    await checkpointStore(directory).save(first.snapshot())
    const restored = await checkpointStore(directory).load()

    expect(restored).toBeDefined()
    const resumed = createStreamModel(restored)

    expect(events.slice(0, 35).flatMap(event => resumed.accept(event))).toEqual([])
    expect(events.slice(35).flatMap(event => resumed.accept(event)))
      .toEqual(events.slice(35).flatMap(event => live.accept(event)))
    expect(resumed.get(shadow.rig)).toEqual(live.get(shadow.rig))
    expect(resumed.snapshot().rigs.get(shadow.rig)?.model.decided.size).toBe(1)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

it('200000 facts retain only per-rig state and one stream sequence; a night preserves decided', () => {
  const runtime = createStreamModel()
  let sequence = 0

  const feed = (event: Parameters<typeof runtime.accept>[0]) => {
    runtime.accept({ ...event, broker: { stream: 'RIG_FACTS', sequence: ++sequence } })
  }

  feed(session(s(-1)))
  const { capture } = modelFixture()
  let nightBytes = 0
  let nightDecided = 0
  let nightDecidedBytes = 0

  for (let index = 0; index < 200000; index++) {
    feed(snapshot({ at: s(index), mount: { at: s(index), raHours: 10, decDegrees: 20 } }))

    if (index < 86000 && index % 86 === 0) {
      feed(frame({ image: imageIdOf(index + 1), capturedAt: s(index - 2), exposureSeconds: 1, seenAt: s(index) }))
    }

    if (index === 85999) {
      nightBytes = serialize(runtime.snapshot()).byteLength
      const decided = runtime.snapshot().rigs.get(capture.rig)!.model.decided

      nightDecided = decided.size
      nightDecidedBytes = serialize(decided).byteLength
    }
  }

  const state = runtime.snapshot()
  const model = state.rigs.get(capture.rig)!.model

  const maps = {
    rigs: state.rigs.size, sequences: state.sequences.size,
    operations: model.link.operations.size, motion: model.motion.active.size,
    frames: model.pending.frames.size, solves: model.pending.solves.size,
    decided: model.decided.size,
  }

  expect(model.counters.inputs).toBeGreaterThanOrEqual(200000)
  expect(maps).toEqual({ rigs: 1, sequences: 1, operations: 0, motion: 0, frames: 0, solves: 0, decided: 1000 })
  expect(nightDecided).toBeGreaterThanOrEqual(990)
  expect(nightBytes).toBeLessThan(1024 ** 2)
  console.log(JSON.stringify({ events: sequence, nightBytes, nightDecided, nightDecidedBytes, maps, finalBytes: serialize(state).byteLength }))
}, 30000)
