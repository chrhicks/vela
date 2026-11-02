import { expect, it } from 'vitest'
import { refusedGoto } from './refused-goto.js'

it('puts the driver’s bare Alert into plain words and keeps the raw text', () => {
  const raw = 'EQUATORIAL_EOD_COORD on ZWO AM5: the driver reported Alert'
  const refused = refusedGoto(new Error(raw))
  expect(refused?.message).toBe('The mount refused the goto. Nothing moved.')
  expect(refused?.detail).toBe(raw)
})

it('adds what Cria says when the refusal carries its own message', () => {
  const refused = refusedGoto(new Error('EQUATORIAL_EOD_COORD on ZWO AM5: site and time not synced, re-sent, try again'))
  expect(refused?.message).toBe('The mount refused the goto. Nothing moved. Cria says: site and time not synced, re-sent, try again.')
})

it.each([
  'EQUATORIAL_EOD_COORD on ZWO AM5: no answer within 10 seconds',
  'ZWO AM5 went away before answering',
  'indiserver connection lost before the driver answered',
  'Mount readings interrupted',
])('leaves an unconfirmed or unrelated failure alone: %s', message => {
  expect(refusedGoto(new Error(message))).toBeUndefined()
})

it('leaves a cancellation alone', () => {
  expect(refusedGoto(new DOMException('Stopped', 'AbortError'))).toBeUndefined()
})
