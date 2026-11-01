import { describe, expect, it } from 'vitest'
import { epochMs } from '@vela/rig-events'
import { joinFrames } from '@vela/rig-frames'
import { frameRecord, savedImage } from './support.ts'

const at = (text: string) => epochMs(Date.parse(text))

describe('joinFrames', () => {
  it('joins on image id and sorts every other case into a named bucket', () => {
    const images = [
      savedImage({ index: 1 }),
      savedImage({ index: 2 }),
      savedImage({ index: 3, capturedAt: at('2026-10-10T20:00:00.000Z') }),
      savedImage({ index: 4, capturedAt: at('2026-10-26T21:00:00.000Z') }),
    ]

    const records = [
      frameRecord({ attempt: 1 }),
      frameRecord({ attempt: 2 }),
      frameRecord({ attempt: 5, outcome: 'unsaved' }),
      frameRecord({ attempt: 6, outcome: 'saved' }),
      frameRecord({ attempt: 7, outcome: 'stopped', image: null }),
      frameRecord({ attempt: 8, outcome: 'stopped', image: null }),
      frameRecord({ attempt: 9, outcome: 'lost', image: null }),
    ]

    const result = joinFrames(images, records)

    expect(result.joined.map(item => [item.image.id, item.record.attempt, item.disagreements])).toEqual([
      [images[0]?.id, 1, []],
      [images[1]?.id, 2, []],
    ])
    expect(result.imagesWithoutRecord.predatesRecords.map(image => image.id)).toEqual([images[2]?.id])
    expect(result.imagesWithoutRecord.unexplained.map(image => image.id)).toEqual([images[3]?.id])
    expect(result.recordsWithoutImage.notKept.map(record => record.attempt)).toEqual([5])
    expect(result.recordsWithoutImage.missing.map(record => record.attempt)).toEqual([6])
    expect([...result.recordsWithoutImageId]).toEqual([
      ['stopped', 2],
      ['lost', 1],
    ])
    expect(result.duplicates).toEqual([])
  })

  it('names the fields on which an image and its record disagree', () => {
    const result = joinFrames([savedImage({ index: 1, exposureSeconds: 30, width: 128, frameType: 'dark' })], [frameRecord({ attempt: 1 })])

    expect(result.joined[0]?.disagreements).toEqual(['size', 'exposureSeconds', 'frameType'])
  })

  it('joins only the first of a repeated image id and reports the repeat', () => {
    const result = joinFrames([savedImage({ index: 1 })], [frameRecord({ attempt: 1 }), frameRecord({ attempt: 1, runId: 'run-2' })])

    expect(result.joined).toHaveLength(1)
    expect(result.duplicates).toHaveLength(1)
  })

  it('treats every image as unexplained when there are no records at all', () => {
    const result = joinFrames([savedImage({ index: 1 })], [])

    expect(result.imagesWithoutRecord.unexplained).toHaveLength(1)
    expect(result.imagesWithoutRecord.predatesRecords).toEqual([])
  })
})
