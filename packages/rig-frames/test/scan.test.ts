import { describe, expect, it } from 'vitest'
import { decodeLine, encodeEvent, rigId, seal, sourceId } from '@vela/rig-events'
import { frameDraft, nightRows, pathsIn, scanFrameSources } from '@vela/rig-frames'
import { dataDirectory, recordLine, writeImage, writeRecords, writeTrial } from './support.ts'

async function night() {
  const dir = await dataDirectory()

  const specs = [
    { index: 1, capturedAt: '2026-10-18T20:00:00.000Z' },
    { index: 2, capturedAt: '2026-10-26T23:50:00.000Z' },
    { index: 3, capturedAt: '2026-10-27T01:10:00.000Z', frameType: 'dark' },
    { index: 4, capturedAt: '2026-10-27T13:00:00.000Z' },
    { index: 5, capturedAt: '2026-10-27T13:05:00.000Z' },
  ]

  for (const spec of specs) await writeImage(dir, spec)

  await writeRecords(dir, [
    recordLine(specs[1]!),
    recordLine(specs[2]!),
    recordLine(specs[3]!),
    recordLine({ attempt: 6, outcome: 'stopped', startedAt: '2026-10-27T13:10:00.000Z' }),
    recordLine({ index: 7, capturedAt: '2026-10-27T13:20:00.000Z' }, 'unsaved'),
  ])

  await writeTrial(dir, { createdAt: '2026-10-26T23:38:03.990Z', outcome: 'finished' })

  return dir
}

describe('scanFrameSources', () => {
  it('reads the three sources once, joins them and groups them by night', async () => {
    const sources = await scanFrameSources(pathsIn(await night()))

    expect(sources.problems).toEqual([])
    expect(sources.join.joined).toHaveLength(3)
    expect(sources.join.imagesWithoutRecord.predatesRecords).toHaveLength(1)
    expect(sources.join.imagesWithoutRecord.unexplained).toHaveLength(1)
    expect(sources.join.recordsWithoutImage.notKept).toHaveLength(1)

    expect(nightRows(sources, 0).map(row => [row.night, row.images, row.joined, row.predatesRecords, row.unexplained, row.trials.length])).toEqual([
      ['2026-10-18', 1, 0, 1, 0, 0],
      ['2026-10-26', 2, 2, 0, 0, 1],
      ['2026-10-27', 2, 1, 0, 1, 0],
    ])
  })
})

describe('frameDraft', () => {
  it('turns every record into a frame fact that survives the codec', async () => {
    const sources = await scanFrameSources(pathsIn(await night()))
    const kept = new Map(sources.savedImages.images.map(image => [image.id, image]))
    const context = [rigId('test-rig'), sourceId('import:frames')] as const

    const events = sources.frameRecords.records.map(record => seal(frameDraft(record, record.image ? kept.get(record.image.id) : undefined, ...context)))

    expect(events).toHaveLength(5)

    for (const event of events) {
      const again = decodeLine(encodeEvent(event))

      expect(again.ok && encodeEvent(again.event)).toBe(encodeEvent(event))
    }

    const [first, , , stopped, unsaved] = events

    expect(first?.id).toBe(`frame:${sources.frameRecords.records[0]?.image?.id}`)
    expect(first?.kind === 'frame' && first.body.image?.ref?.uri).toMatch(/^file:\/\/\/.*original\.fits$/)
    expect(first?.kind === 'frame' && first.body.image?.ref?.sha256).toBeNull()
    expect(stopped?.kind === 'frame' && stopped.body.image).toBeNull()
    expect(unsaved?.kind === 'frame' && unsaved.body.image?.ref).toBeNull()
  })
})
