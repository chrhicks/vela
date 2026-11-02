import { encodeEvent, type ArchiveRange, type RigEvent } from '@vela/rig-events'
import { readArchive } from '../run-log/archive.js'
import { createStreamModel, shadowModelSource } from './stream.js'

export async function compareModelReplay(directory: string, range: ArchiveRange) {
  if (!Number.isFinite(range.from) || !Number.isFinite(range.to) || range.from > range.to)
    throw new Error('Invalid archive time range')

  const runtime = createStreamModel()
  const expected: RigEvent[] = []
  const actual: RigEvent[] = []
  const within = (event: RigEvent) => event.at >= range.from && event.at <= range.to

  for await (const event of readArchive(directory, { from: 0, to: 253402300799999 })) {
    expected.push(...runtime.accept(event).filter(within))

    if (event.source === shadowModelSource && within(event)) {
      const { broker: _broker, ...envelope } = event

      actual.push(envelope)
    }
  }

  for (let index = 0; index < Math.max(expected.length, actual.length); index++) {
    const replayed = expected[index]
    const live = actual[index]

    if (!replayed || !live || encodeEvent(replayed) !== encodeEvent(live))
      return { equal: false, index, replayed: replayed ?? null, live: live ?? null }
  }

  return { equal: true, assessments: expected.length }
}
