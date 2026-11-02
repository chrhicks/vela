import { expect, it } from 'vitest'
import { refusedGoto } from './refused-goto.js'

it('puts the driver’s bare Alert into plain words and keeps the raw text', () => {
  const raw = 'EQUATORIAL_EOD_COORD on ZWO AM5: the driver reported Alert'
  const refused = refusedGoto(new Error(raw))
  expect(refused?.message).toBe('The mount refused the goto. Nothing moved.')
  expect(refused?.detail).toBe(raw)
})

it.each([
  'EQUATORIAL_EOD_COORD on ZWO AM5: no answer within 10 seconds',
  'ZWO AM5 went away before answering',
  'indiserver connection lost before the driver answered',
  'ON_COORD_SET on ZWO AM5: the driver still shows the old values',
  'ON_COORD_SET on ZWO AM5: the device did not show the requested state within 15 seconds',
  'slew on ZWO AM5 started but did not complete: the driver reported Alert',
  'EQUATORIAL_EOD_COORD on ZWO AM5: the driver reported Alert; stop on ZWO AM5: not confirmed',
  'EQUATORIAL_EOD_COORD on ZWO AM5: site and time not synced, re-sent, try again',
  'Mount readings interrupted',
])('leaves any other failure alone, since the mount may have moved: %s', message => {
  expect(refusedGoto(new Error(message))).toBeUndefined()
})
