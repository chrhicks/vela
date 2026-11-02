import { CommandNotStartedError, EquipmentError, type CommandNotStartedReason } from '@vela/equipment'
import { expect, it } from 'vitest'
import { refusedGoto } from './refused-goto.js'

const notStarted = (message: string, refusal: CommandNotStartedReason) =>
  new CommandNotStartedError(message, refusal, { reason: 'protocol-error', endpoint: 'Cria' })

it('puts the driver’s bare Alert into plain words and keeps the raw text', () => {
  const raw = 'EQUATORIAL_EOD_COORD on ZWO AM5: the driver reported Alert'
  const refused = refusedGoto(notStarted(raw, 'rejected'))
  expect(refused?.message).toBe('The mount refused the goto. Nothing moved.')
  expect(refused?.detail).toBe(raw)
})

it('adds what Cria says when the refusal carries its own message', () => {
  const refused = refusedGoto(
    notStarted('EQUATORIAL_EOD_COORD on ZWO AM5: site and time not synced, re-sent, try again', 'rejected'),
  )

  expect(refused?.message).toBe('The mount refused the goto. Nothing moved. Cria says: site and time not synced, re-sent, try again.')
})

it.each([
  ['busy', 'The mount is busy with another operation. Nothing moved. Cria says: Busy with run 4.'],
  ['disconnected', 'Vela cannot reach the mount. Nothing moved. Cria says: ZWO AM5 is disconnected.'],
  ['unavailable', 'Vela cannot reach the mount. Nothing moved. Cria says: Cria never admitted mount-slew.'],
] as const)('names a %s mount and keeps what Cria said', (refusal, message) => {
  const said = message.split('Cria says: ')[1]!.replace(/\.$/, '')
  expect(refusedGoto(notStarted(said, refusal))?.message).toBe(message)
})

it.each([
  new EquipmentError('ON_COORD_SET on ZWO AM5: the driver still shows the old values', { reason: 'protocol-error', endpoint: 'Cria' }),
  new EquipmentError('EQUATORIAL_EOD_COORD on ZWO AM5: the driver reported Alert', { reason: 'protocol-error', endpoint: 'Cria' }),
  new Error('Mount readings interrupted'),
  new DOMException('Stopped', 'AbortError'),
])('leaves any failure that may have moved the mount alone: %s', error => {
  expect(refusedGoto(error)).toBeUndefined()
})
