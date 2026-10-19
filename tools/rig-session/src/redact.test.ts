import { expect, test } from 'vitest'
import { redactedJson, redactText } from './redact.ts'

test('text that names the site in words is replaced whole, whatever shape its numbers take', () => {
  expect(redactText('[INFO] Observer location updated: Latitude 12:30:00.0 (12.50) Longitude -14:45:00.0 (-14.75)')).toBe('[redacted] (names the site)')
  expect(redactText('Geographic coordinates set')).toBe('[redacted] (names the site)')
})

test('pairs and serial paths are replaced inside text that is otherwise kept', () => {
  expect(redactText('sent LAT=12.5 LONG=345.25 ELEV=0')).toBe('sent LAT=[redacted] LONG=[redacted] ELEV=[redacted]')
  expect(redactText('open /dev/ttyUSB0 failed')).toBe('open [redacted] failed')
  expect(redactText('exposure failed: cooler fault')).toBe('exposure failed: cooler fault')
})

test('site and port keys lose their values at any depth, and other values are kept', () => {
  expect(redactedJson({ exposureSeconds: 50, setup: { latitude: 12.5, note: 'at /dev/ttyUSB0' }, list: [{ serialNumber: 'abc' }, 3] })).toEqual({
    exposureSeconds: 50,
    setup: { latitude: '[redacted]', note: 'at [redacted]' },
    list: [{ serialNumber: '[redacted]' }, 3],
  })
})
