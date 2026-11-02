import { Schema } from 'effect'
import { Operation } from '@cria/wire'
import { expect, it } from 'vitest'

const id = '00000000-0000-4000-8000-000000000001'

const settled = {
  id,
  instanceId: id,
  requestId: id,
  deviceId: 'mount',
  bindingId: id,
  expectedName: 'Fake mount',
  failureDomain: 'mount',
  acceptedAt: 1,
  startedAt: 2,
  settledAt: 3,
  state: 'settled',
  kind: 'mount-home',
  parameters: {},
  outcome: { kind: 'confirmed', value: { values: {}, image: null } },
  recovery: null,
}

it('reads the motion record and accepts future fields on a settled operation', () => {
  const motion = {
    commanded: { kind: 'home', sentAt: 2 },
    observed: {
      from: { rightAscensionDegrees: 30, declinationDegrees: 40 },
      to: { rightAscensionDegrees: 45, declinationDegrees: 40 },
      travel: { rightAscensionDegrees: 15, declinationDegrees: 0 },
    },
    stopped: { how: 'arrived', at: 3 },
  }

  const operation = { ...settled, futureField: true, motion }
  const decoded = Schema.decodeUnknownSync(Schema.fromJsonString(Operation))(JSON.stringify(operation))

  expect(decoded).toMatchObject({ state: 'settled', motion })
  expect(decoded).not.toHaveProperty('futureField')
})

it('decodes old settled operations without a motion record', () => {
  expect(Schema.decodeUnknownSync(Operation)(settled)).toEqual(settled)
})
