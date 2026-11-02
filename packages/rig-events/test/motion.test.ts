import { expect, it } from 'vitest'
import { criaEvent, decodeLine, encodeEvent, rigId, sourceId } from '@vela/rig-events'
import { motionState } from './motion-sample.ts'

it.each([true, false])('round-trips a cria.state snapshot with motion record present = %s', withRecord => {
  const event = criaEvent({ kind: 'state', at: 230, origin: 'http://cria.test', state: motionState(withRecord) }, { rig: rigId('test-rig'), source: sourceId('test:motion') })
  const line = encodeEvent(event)

  expect(decodeLine(line)).toEqual({ ok: true, event })
  expect(line).toMatchSnapshot()
})
