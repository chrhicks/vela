import { expect, test } from 'vitest'
import { indiEvents } from './indi.ts'
import type { RecordedLine } from './recording.ts'

const line = (n: number, dir: 'in' | 'out', xml: string): RecordedLine => ({ k: 'msg', at: new Date('2030-01-01T01:00:00Z'), conn: 1, dir, n, xml })

const number = (state: string, ...elements: [string, string][]) =>
  `<setNumberVector device="Mount" name="EQUATORIAL_EOD_COORD" state="${state}">${elements.map(([name, value]) => `<oneNumber name="${name}">${value}</oneNumber>`).join('')}</setNumberVector>`

test('a property is defined once, then only a change of state or value is an event', () => {
  const events = indiEvents([
    line(0, 'in', '<defNumberVector device="Mount" name="EQUATORIAL_EOD_COORD" state="Idle"><defNumber name="RA" min="0">1</defNumber><defNumber name="DEC">2</defNumber></defNumberVector>'),
    line(1, 'in', '<defNumberVector device="Mount" name="EQUATORIAL_EOD_COORD" state="Idle"><defNumber name="RA">1</defNumber><defNumber name="DEC">2</defNumber></defNumberVector>'),
    line(2, 'in', number('Idle', ['RA', '1'])),
    line(3, 'in', number('Idle', ['RA', '1.5'])),
    line(4, 'in', number('Busy', ['RA', '1.5'])),
  ])

  expect(events.map(event => [event.n, event.kind, event.state, event.values, event.changed])).toEqual([
    [0, 'define', 'Idle', { RA: '1', DEC: '2' }, null],
    [3, 'update', 'Idle', { RA: '1.5' }, { RA: '1.5' }],
    [4, 'update', 'Busy', { RA: '1.5' }, {}],
  ])
})

test('a set that arrives before any definition is an update that changed everything it carries', () => {
  expect(indiEvents([line(0, 'in', number('Ok', ['RA', '1']))]).map(event => [event.kind, event.changed])).toEqual([['update', { RA: '1' }]])
})

test('a BLOB is an event every time, with its size, and messages, writes and deletions are events with their text', () => {
  const blob = '<setBLOBVector device="Cam" name="CCD1" state="Ok"><oneBLOB name="CCD1" size="5000" format=".fits" ref="blobs/1-5-0.blob"/></setBLOBVector>'

  const events = indiEvents([
    line(0, 'in', blob),
    line(1, 'in', blob),
    line(2, 'in', '<message device="Cam" message="exposure &amp; download done"/>'),
    line(0, 'out', '<newSwitchVector device="Mount" name="TELESCOPE_TRACK_STATE"><oneSwitch name="ON">On</oneSwitch></newSwitchVector>'),
    line(3, 'in', '<delProperty device="Mount" name="TELESCOPE_TRACK_STATE"/>'),
    line(1, 'out', '<getProperties version="1.7"/>'),
  ])

  expect(events.map(event => [event.kind, event.direction, event.device, event.property, event.values, event.text])).toEqual([
    ['update', 'in', 'Cam', 'CCD1', { CCD1: '5000' }, null],
    ['update', 'in', 'Cam', 'CCD1', { CCD1: '5000' }, null],
    ['message', 'in', 'Cam', null, null, 'exposure & download done'],
    ['write', 'out', 'Mount', 'TELESCOPE_TRACK_STATE', { ON: 'On' }, null],
    ['delete', 'in', 'Mount', 'TELESCOPE_TRACK_STATE', null, null],
  ])
})

test('a property that is not on the list of safe ones is an event with no values, however it is written', () => {
  const site = (value: string) => `<setNumberVector device="Mount" name="GEOGRAPHIC_COORD" state="Ok"><oneNumber name="LAT">${value}</oneNumber></setNumberVector>`
  const text = '<setTextVector device="Mount" name="SOME_NEW_PROPERTY" state="Ok"><oneText name="NOTE">open /dev/ttyUSB0 LAT=12.5 LONG=345.25</oneText></setTextVector>'

  const events = indiEvents([line(0, 'in', site('1')), line(1, 'in', site('1')), line(2, 'in', site('2')), line(3, 'in', text), line(0, 'out', text.replace('setText', 'newText'))])

  expect(events.map(event => [event.n, event.direction, event.property, event.kind, event.values, event.changed])).toEqual([
    [0, 'in', 'GEOGRAPHIC_COORD', 'update', null, null],
    [2, 'in', 'GEOGRAPHIC_COORD', 'update', null, null],
    [3, 'in', 'SOME_NEW_PROPERTY', 'update', null, null],
    [0, 'out', 'SOME_NEW_PROPERTY', 'write', null, null],
  ])
})

test('what a property held is forgotten when its connection closes or the recording has a gap', () => {
  const read = (n: number) => line(n, 'in', number('Ok', ['RA', '1']))
  const closed: RecordedLine = { k: 'conn', at: new Date('2030-01-01T01:00:00Z'), conn: 1, status: 'closed' }
  const gap: RecordedLine = { k: 'gap', at: new Date('2030-01-01T01:00:00Z'), reason: 'queue full' }

  expect(indiEvents([read(0), read(1), closed, read(2), read(3), gap, read(4)]).map(event => [event.n, event.kind, event.changed])).toEqual([
    [0, 'update', { RA: '1' }],
    [2, 'update', { RA: '1' }],
    [4, 'update', { RA: '1' }],
  ])
})
