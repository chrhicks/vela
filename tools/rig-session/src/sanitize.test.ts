import { expect, test } from 'vitest'
import { leaks, sanitizeJson, sanitizeRow, sanitizeText, Secrets } from './sanitize.ts'

const none = new Secrets()

test('paths, ids, pairs and credentials are replaced by pattern, in text that is otherwise kept', () => {
  expect(sanitizeText('open /dev/serial/by-id/usb-Test_0001 failed', none)).toBe('open [redacted] failed')
  expect(sanitizeText('device usb-Test_Device_0001-if00 lost', none)).toBe('device [redacted] lost')
  expect(sanitizeText('sent LAT=12.5 LONG=345.25 ELEV=0', none)).toBe('sent LAT=[redacted] LONG=[redacted] ELEV=[redacted]')
  expect(sanitizeText('GET https://user:pass@host.test/x?token=abc123&y=1', none)).toBe('GET https://[redacted]@host.test/x?token=[redacted]&y=1')
  expect(sanitizeText('Authorization: Bearer abcdefghijkl12345', none)).toBe('Authorization: Bearer [redacted]')
  expect(sanitizeText('exposure failed: cooler fault', none)).toBe('exposure failed: cooler fault')
})

test('a text that names the site in words is replaced whole, but a property name is not', () => {
  expect(sanitizeText('[INFO] Observer location updated: Latitude 12:30:00.0 Longitude -14:45:00.0', none)).toBe('[redacted] (names the site)')
  expect(sanitizeText('Geographic coordinates set', none)).toBe('[redacted] (names the site)')
  expect(sanitizeText('GEOGRAPHIC_COORD', none)).toBe('GEOGRAPHIC_COORD')
})

test('what is not private is left alone: a path under a dev folder, a timestamp, a digest', () => {
  const kept = ['/home/test/dev/project/saved/frame-1', '2030-01-01T01:12:30.000Z', 'a'.repeat(64), '["2030-01-01T01:00:58.000Z"]']

  for (const text of kept) expect(sanitizeText(text, none)).toBe(text)
})

test('replacing twice changes nothing, so the check after the write can pass', () => {
  const secrets = new Secrets()

  secrets.addCoordinate('latitude', 12.534)
  secrets.addLiteral('/dev/ttyUSB7')

  for (const text of ['at LAT=12.534 on /dev/ttyUSB7', 'Latitude 12.534', 'https://u:p@h.test/?key=abcdefg', 'usb-Test_0001']) {
    const once = sanitizeText(text, secrets)

    expect(sanitizeText(once, secrets)).toBe(once)
    expect(leaks(once, secrets)).toEqual([])
  }
})

test('a learned coordinate is replaced in any common formatting, in any text', () => {
  const secrets = new Secrets()

  secrets.addCoordinate('latitude', 12.534)
  secrets.addCoordinate('longitude', -14.75)

  const spellings = [
    'height 12.534 m',
    'rounded 12.53 and 12.5',
    'sign -12.534 here',
    'sexagesimal 12:32:02.4 here',
    'spaces 12 32 02 here',
    'marks 12°32\'02.4" here',
    'wrapped 345.25 here',
    'signed -14.75 here',
    'degrees and minutes 14°45\' here',
  ]

  for (const text of spellings) {
    const cleaned = sanitizeText(text, secrets)

    expect(cleaned, text).toContain('[redacted]')
    expect(leaks(cleaned, secrets), text).toEqual([])
  }

  expect(sanitizeText('frame-345 at 2030-01-01T01:12:30.000Z', secrets)).toBe('frame-345 at 2030-01-01T01:12:30.000Z')
})

test('a learned literal is replaced wherever it appears, and one too short to be distinctive is ignored', () => {
  const secrets = new Secrets()

  secrets.addLiteral('ttyACM4-extra')
  secrets.addLiteral('ab')

  expect(sanitizeText('port ttyACM4-extra, ab', secrets)).toBe('port [redacted], ab')
})

test('JSON is sanitised at every depth, keys included, and a private key loses its value', () => {
  const secrets = new Secrets()

  secrets.addCoordinate('latitude', 12.534)

  expect(sanitizeJson({ exposureSeconds: 50, setup: { latitude: 99, note: 'at /dev/ttyUSB0', where: 12.534 }, list: [{ serialNumber: 'abc' }, 3, 'LAT=1.5'] }, secrets)).toEqual({
    exposureSeconds: 50,
    setup: { latitude: '[redacted]', note: 'at [redacted]', where: '[redacted]' },
    list: [{ serialNumber: '[redacted]' }, 3, 'LAT=[redacted]'],
  })
})

test('a row is sanitised from its column kinds, whatever the columns are called', () => {
  const columns = { never_heard_of: { kind: 'text', nullable: true }, also_new: { kind: 'json', nullable: false }, count: { kind: 'int', nullable: false } } as const

  expect(sanitizeRow({ never_heard_of: 'open /dev/ttyUSB0', also_new: '{"a":["usb-Test_0001",{"b":"LAT=12.5"}]}', count: 3 }, columns, none)).toEqual({
    never_heard_of: 'open [redacted]',
    also_new: '{"a":["[redacted]",{"b":"LAT=[redacted]"}]}',
    count: 3,
  })
})
