import { expect, test } from 'vitest'
import { linkMountAsOf } from './joins.ts'
import { mountSamplesOf } from './mount.ts'
import { fakeDevices } from './recording-fixture.ts'
import type { RecordedLine } from './recording.ts'

type Message = Extract<RecordedLine, { k: 'msg' }>

let counter = 0

const message = (time: string, xml: string): Message => ({ k: 'msg', at: new Date(`2030-01-01T${time}Z`), conn: 1, dir: 'in', n: (counter += 1), xml })

const vector = (kind: 'def' | 'set', type: 'Number' | 'Switch', name: string, state: string, elements: Record<string, string>) =>
  `<${kind}${type}Vector device="Test Mount" name="${name}" state="${state}">${Object.entries(elements)
    .map(([element, value]) => `<${kind === 'def' ? 'def' : 'one'}${type} name="${element}">${value}</${kind === 'def' ? 'def' : 'one'}${type}>`)
    .join('')}</${kind}${type}Vector>`

const site = vector('def', 'Number', 'GEOGRAPHIC_COORD', 'Ok', { LAT: '12.5', LONG: '15', ELEV: '0' })

test('mount samples follow position, slewing, tracking, pier side and track mode, with sidereal time from the recorded longitude', () => {
  const samples = mountSamplesOf(
    [
      message('00:59:10', site),
      message('00:59:11', vector('def', 'Number', 'EQUATORIAL_EOD_COORD', 'Idle', { RA: '6.5', DEC: '10.25' })),
      message('00:59:12', vector('def', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'On', TRACK_OFF: 'Off' })),
      message('00:59:13', vector('def', 'Switch', 'TELESCOPE_PIER_SIDE', 'Ok', { PIER_WEST: 'Off', PIER_EAST: 'On' })),
      message('00:59:14', vector('def', 'Switch', 'TELESCOPE_TRACK_MODE', 'Ok', { TRACK_SIDEREAL: 'On', TRACK_SOLAR: 'Off' })),
      message('00:59:15', vector('def', 'Switch', 'TELESCOPE_PARK', 'Ok', { PARK: 'Off', UNPARK: 'On' })),
      message('00:59:16', vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Busy', { RA: '6.75' })),
      message('00:59:17', vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '6.75' })),
      message('00:59:18', vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '6.75' })),
      message('00:59:19', vector('set', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'Off', TRACK_OFF: 'On' })),
      message('00:59:20', vector('set', 'Number', 'POLLING_PERIOD', 'Ok', { PERIOD_MS: '1000' })),
    ],
    fakeDevices,
  )

  expect(samples.map(sample => [sample.sampledAt.toISOString().slice(11, 19), sample.raHours, sample.slewing, sample.tracking, sample.pierSide, sample.trackMode, sample.parked])).toEqual([
    ['00:59:11', 6.5, false, null, null, null, null],
    ['00:59:12', 6.5, false, true, null, null, null],
    ['00:59:13', 6.5, false, true, 'east', null, null],
    ['00:59:14', 6.5, false, true, 'east', 'sidereal', null],
    ['00:59:15', 6.5, false, true, 'east', 'sidereal', false],
    ['00:59:16', 6.75, true, true, 'east', 'sidereal', false],
    ['00:59:17', 6.75, false, true, 'east', 'sidereal', false],
    ['00:59:19', 6.75, false, false, 'east', 'sidereal', false],
  ])
  expect(samples[0]?.decDegrees).toBe(10.25)
  expect(samples[0]?.lstHours).toBeCloseTo(8.7021, 3)
  expect(samples.every(sample => sample.source === 'indi')).toBe(true)
})

test('without a recorded longitude sidereal time is null, and a mount that was never positioned gives no sample', () => {
  expect(mountSamplesOf([message('00:59:12', vector('def', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'On' }))], fakeDevices)).toEqual([])

  const [sample] = mountSamplesOf([message('00:59:11', vector('def', 'Number', 'EQUATORIAL_EOD_COORD', 'Idle', { RA: '6.5', DEC: '10.25' }))], fakeDevices)

  expect(sample?.lstHours).toBeNull()
})

test('two changes in one millisecond make one sample, and another device or a recording with no mount gives none', () => {
  const coordinates = vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '1', DEC: '2' })
  const tracking = vector('set', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'On' })

  expect(mountSamplesOf([message('00:59:11', coordinates), message('00:59:11', tracking)], fakeDevices).map(sample => sample.tracking)).toEqual([true])
  expect(mountSamplesOf([message('00:59:11', coordinates.replace('Test Mount', 'Other'))], fakeDevices)).toEqual([])
  expect(mountSamplesOf([message('00:59:11', coordinates)], [])).toEqual([])
})

test('a sample holds until its connection closes, and linking honours that where a polled sample would have gone stale', () => {
  const coordinates = vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '1', DEC: '2' })

  const samples = mountSamplesOf(
    [
      message('00:59:11', coordinates),
      { k: 'conn', at: new Date('2030-01-01T01:30:00Z'), conn: 1, status: 'closed' },
      message('01:31:00', coordinates.replace('>1<', '>1.5<')),
    ],
    fakeDevices,
  )

  expect(samples.map(sample => sample.validUntil)).toEqual([new Date('2030-01-01T01:30:00Z'), null])
  expect(linkMountAsOf(new Date('2030-01-01T01:29:00Z'), samples, 30)).toMatchObject({ link: { kind: 'inferred' }, ageSeconds: 1789 })
  expect(linkMountAsOf(new Date('2030-01-01T01:30:30Z'), samples, 30)).toBeNull()
  expect(linkMountAsOf(new Date('2030-01-01T01:35:00Z'), samples, 30)?.ageSeconds).toBe(240)
})

const position = vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '6.5', DEC: '10.25' })

const trackingOn = vector('set', 'Switch', 'TELESCOPE_TRACK_STATE', 'Ok', { TRACK_ON: 'On', TRACK_OFF: 'Off' })

const hourLater = new Date('2030-01-01T02:00:00Z')

test('a mount whose device disconnects, or whose properties are deleted, stops being in force, however long ago it spoke', () => {
  const disconnect = vector('set', 'Switch', 'CONNECTION', 'Ok', { CONNECT: 'Off', DISCONNECT: 'On' })
  const deleted = '<delProperty device="Test Mount" name="EQUATORIAL_EOD_COORD"/>'

  for (const loss of [disconnect, deleted]) {
    const samples = mountSamplesOf([message('00:59:11', position), message('00:59:12', trackingOn), message('01:00:00', loss)], fakeDevices)

    expect(samples.map(sample => sample.validUntil), loss).toEqual([new Date('2030-01-01T01:00:00Z'), new Date('2030-01-01T01:00:00Z')])
    expect(linkMountAsOf(hourLater, samples, 30), loss).toBeNull()
  }
})

test('after the connection closes and the mount returns, a sample never carries a field from before', () => {
  const samples = mountSamplesOf(
    [
      message('00:59:11', position),
      { k: 'conn', at: new Date('2030-01-01T01:00:00Z'), conn: 1, status: 'closed' },
      { k: 'conn', at: new Date('2030-01-01T01:00:05Z'), conn: 2, status: 'connected' },
      { ...message('01:00:06', trackingOn), conn: 2 },
      { ...message('01:00:07', vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '7' })), conn: 2 },
      { ...message('01:00:08', vector('set', 'Number', 'EQUATORIAL_EOD_COORD', 'Ok', { RA: '7', DEC: '11' })), conn: 2 },
    ],
    fakeDevices,
  )

  // Tracking alone makes no sample, and RA without a DEC is not a position: nothing of the old RA or DEC survives.
  expect(samples.map(sample => [sample.sampledAt.toISOString().slice(11, 19), sample.raHours, sample.decDegrees, sample.tracking])).toEqual([
    ['00:59:11', 6.5, 10.25, null],
    ['01:00:08', 7, 11, true],
  ])
})

test('a connection that never carried the mount closing does not end the mount', () => {
  const samples = mountSamplesOf([message('00:59:11', position), { k: 'conn', at: new Date('2030-01-01T01:00:00Z'), conn: 9, status: 'closed' }], fakeDevices)

  expect(samples.map(sample => sample.validUntil)).toEqual([null])
})

test('a recording that did not end cleanly ends the evidence where it stopped', () => {
  const samples = mountSamplesOf([message('00:59:11', position), message('00:59:12', trackingOn)], fakeDevices, new Date('2030-01-01T01:00:00Z'))

  expect(samples.map(sample => sample.validUntil)).toEqual([new Date('2030-01-01T01:00:00Z'), new Date('2030-01-01T01:00:00Z')])
  expect(linkMountAsOf(hourLater, samples, 30)).toBeNull()
  expect(linkMountAsOf(new Date('2030-01-01T00:59:30Z'), samples, 30)).toMatchObject({ link: { kind: 'inferred' } })
})
