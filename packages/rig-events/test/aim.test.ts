import { expect, it } from 'vitest'
import { decodeLine, encodeEvent } from '@vela/rig-events'
import { aimEvent } from './aim-sample.ts'

const golden =
  '{"at":1000,"body":{"blindTravelDegrees":1,"confidence":"low","corrections":0,"elapsedMs":1000,"goalId":"goal-1","gotoMissArcmin":73.2,"gotoWarning":true,"gotoWarningArcmin":15,"maxCorrections":4,"maxElapsedMs":240000,"pointingBudgetArcmin":2,"reason":"outside-tolerance","residualArcmin":73.2,"status":"missed","target":{"decDegrees":20,"raDegrees":10},"toleranceArcmin":0.5},"id":"aim:test-rig:goal-1","kind":"aim","rig":"test-rig","seenAt":1000,"source":"vela:aim","v":1}'

it('writes and reads the Aim event golden line', () => {
  expect(encodeEvent(aimEvent)).toBe(golden)
  expect(decodeLine(golden)).toEqual({ ok: true, event: aimEvent })
  expect(decodeLine(golden.replace('"status":"missed"', '"status":"checked"')).ok).toBe(false)
})
