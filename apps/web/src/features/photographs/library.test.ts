import type { SavedImage } from '@vela/model/web'
import { describe, expect, it } from 'vitest'
import { groupPhotographs, photographNight, photographNightTitle, photographTarget } from './library'
import { photographDate, photographTime } from './format'

const zone = 'America/New_York'

function image(id: string, capturedAt: string, targetId?: string): SavedImage {
  return {
    id, capturedAt, receivedAt: capturedAt, savedAt: capturedAt,
    subject: targetId ? { targetId, name: 'Same display name', catalog: 'Test' } : null,
    rigId: 'rig', cameraName: 'Camera', color: 'mono', width: 1, height: 1,
    exposureSeconds: 1, statistics: null, saved: true,
    imageUrl: '', fitsUrl: '', previewDownloadUrl: '',
  }
}

describe('observing-night calendar', () => {
  it.each([
    ['2026-10-02T03:59:59Z', '2026-10-01'], // before midnight
    ['2026-10-02T04:00:00Z', '2026-10-01'], // after midnight
    ['2026-10-02T15:59:59Z', '2026-10-01'], // before noon
    ['2026-10-02T16:00:00Z', '2026-10-02'], // noon
    ['2026-03-08T16:00:00Z', '2026-03-08'], // noon after spring DST jump
    ['2026-03-08T15:59:59Z', '2026-03-07'],
    ['2026-03-08T06:30:00Z', '2026-03-07'],
    ['2026-03-08T07:30:00Z', '2026-03-07'],
    ['2026-11-01T05:30:00Z', '2026-10-31'], // repeated autumn hour
    ['2026-11-01T06:30:00Z', '2026-10-31'],
    ['2026-11-01T16:59:59Z', '2026-10-31'],
    ['2026-11-01T17:00:00Z', '2026-11-01'],
    ['2026-01-01T06:00:00Z', '2025-12-31'],
    ['2028-03-01T06:00:00Z', '2028-02-29'],
  ])('maps %s to the evening %s in server time', (timestamp, night) => {
    expect(photographNight(timestamp, zone)).toBe(night)
  })

  it('uses the supplied zone independently of the client default', () => {
    expect(photographNight('2026-10-01T15:00:00Z', zone)).toBe('2026-09-30')
    expect(photographNight('2026-10-01T15:00:00Z', 'UTC')).toBe('2026-10-01')
    expect(photographNightTitle('2026-09-30')).toBe('30 Sep 2026')
    expect(photographDate('2026-10-02T02:30:00Z', true, zone)).toBe('1 Oct 2026')
    expect(photographTime('2026-10-02T02:30:00Z', zone)).toBe('22:30:00')
  })
})

it('groups existing metadata without changing server order or combining target identities', () => {
  const images = [
    image('new', '2026-10-02T05:00:00Z', 'one'),
    image('evening', '2026-10-02T02:00:00Z', 'two'),
    image('old', '2026-10-01T02:00:00Z', 'one'),
    image('unknown', '2026-09-30T02:00:00Z'),
    { ...image('legacy', '2026-09-30T01:00:00Z'), subject: undefined },
  ]

  const nights = groupPhotographs(images, 'nights', zone)
  expect(nights.map(group => [group.id, group.images.map(item => item.id)])).toEqual([
    ['2026-10-01', ['new', 'evening']],
    ['2026-09-30', ['old']],
    ['2026-09-29', ['unknown', 'legacy']],
  ])
  const targets = groupPhotographs(images, 'targets', zone)
  expect(targets.map(group => [group.id, group.images.map(item => item.id)])).toEqual([
    ['target:one', ['new', 'old']], ['target:two', ['evening']], ['unrecorded', ['unknown', 'legacy']],
  ])
  expect(targets.at(-1)?.title).toBe('No recorded target')
  expect(photographTarget(image('collision', '2026-10-01T00:00:00Z', 'unrecorded')).id).toBe('target:unrecorded')
  expect(groupPhotographs([], 'nights', zone)).toEqual([])
})
