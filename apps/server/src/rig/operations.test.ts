import { expect, it } from 'vitest'
import { createRigOperations, type RigHold } from './operations.js'

const mountHold: RigHold = {
  deviceId: 'cria:fra-cria:mount',
  reason: 'The mount did not confirm it stopped. Check it before recovering.',
}

it('reports a hold before the lease and refuses every new operation while it lasts', () => {
  let holds: ReadonlyArray<RigHold> = []
  const operations = createRigOperations(rigId => (rigId === 'fra' ? holds : []))
  const releaseCapture = operations.acquire('fra', 'capture')!

  holds = [mountHold]

  expect(operations.owner('fra')).toEqual(mountHold)
  expect(operations.acquire('fra', 'autofocus')).toBeUndefined()

  releaseCapture()

  expect(operations.owner('fra')).toEqual(mountHold)
  expect(operations.acquire('fra', 'connection')).toBeUndefined()
  expect(operations.acquire('fra', 'rig-management')).toBeUndefined()
  expect(operations.owner('other')).toBeUndefined()

  holds = []

  expect(operations.owner('fra')).toBeUndefined()
  const releaseAutofocus = operations.acquire('fra', 'autofocus')
  expect(operations.owner('fra')).toBe('autofocus')
  releaseAutofocus!()
  expect(operations.owner('fra')).toBeUndefined()
})

it('keeps one owner per Rig when nothing is held', () => {
  const operations = createRigOperations()
  const release = operations.acquire('fra', 'capture')!

  expect(operations.acquire('fra', 'autofocus')).toBeUndefined()
  expect(operations.owner('fra')).toBe('capture')

  release()
  release()

  expect(operations.owner('fra')).toBeUndefined()
  expect(operations.acquire('fra', 'autofocus')).toBeInstanceOf(Function)
})
