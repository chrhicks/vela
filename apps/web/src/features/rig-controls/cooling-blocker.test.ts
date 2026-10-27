import { expect, it } from 'vitest'
import { coolingBlocker } from './cooling-blocker'

it('explains a device hold with the reason the server reported', () => {
  expect(
    coolingBlocker({ kind: 'hold', reason: 'The mount did not confirm it stopped.' }, '/rigs/fra'),
  ).toEqual({ message: 'The mount did not confirm it stopped.' })
  expect(coolingBlocker('autofocus', '/rigs/fra')).toEqual({
    message: 'Autofocus is using the rig. Cooling can change when it finishes.',
    action: { label: 'Open autofocus', to: '/rigs/fra/observe/autofocus' },
  })
})
