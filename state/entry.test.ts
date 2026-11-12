import { Option, Result } from 'effect'
import { describe, expect, it } from 'vitest'
import { decodeWireBody, makeReader } from './entry.ts'
import { Environment, streamOf } from './stream.ts'

const stream = streamOf(Environment.make('test'))
const readMessage = makeReader(stream)

describe('readMessage', () => {
  it('reads an entry with its stream position', () => {
    const text = JSON.stringify({ v: 2, id: 'wire:1', rig: 'phoenix', kind: 'wire', at: 5, source: 'rig:rig', body: { dir: 'in', device: 'mount', type: 'set', property: 'TELESCOPE_PARK', elements: { PARK: true } } })

    expect(Result.getOrThrow(readMessage({ seq: 41, subject: 'rig-test.wire.mount', time: 6, text }))).toEqual({ seq: 41, kind: 'wire', at: 5, body: expect.any(Object) })
  })

  it('reads a command request as an entry, with the device from its subject and the time from the broker', () => {
    const text = JSON.stringify({ id: 'vela-1', property: 'ABS_FOCUS_POSITION', values: { FOCUS_ABSOLUTE_POSITION: 1200 }, by: 'vela' })

    expect(Result.getOrThrow(readMessage({ seq: 42, subject: stream.command('focuser'), time: 9000, text }))).toEqual({
      seq: 42,
      kind: 'command',
      at: 9000,
      body: { id: 'vela-1', property: 'ABS_FOCUS_POSITION', values: { FOCUS_ABSOLUTE_POSITION: 1200 }, by: 'vela', device: 'focuser' },
    })
  })

  it('fails with the position, subject and issue for text that is not an entry or a request', () => {
    for (const [subject, text] of [
      ['rig-test.client', 'not json'],
      ['rig-test.client', '[]'],
      ['rig-test.client', JSON.stringify({ kind: 'wire' })],
      [stream.command('mount'), 'not json'],
    ] as const) {
      const read = readMessage({ seq: 1, subject, time: 0, text })

      expect(Result.isFailure(read) && read.failure).toMatchObject({ _tag: 'UnreadableMessage', seq: 1, subject })
    }
  })
})

describe('streamOf', () => {
  it('names the stream and its subjects after the environment', () => {
    expect(streamOf(Environment.make('prod'))).toMatchObject({ name: 'RIG_PROD', client: 'rig-prod.client', followed: ['rig-prod.wire.>', 'rig-prod.client', 'rig-prod.phd2', 'rig-prod.vela.>', 'rig-prod.command.>'] })
    expect(stream.vela('frame')).toBe('rig-test.vela.frame')
    expect(stream.commandDevice('rig-test.command.mount')).toBe('mount')
    expect(stream.commandDevice('rig-dev.command.mount')).toBeUndefined()
  })
})

describe('decodeWireBody', () => {
  it('keeps the elements that are numbers, switches or text and drops the rest', () => {
    const wire = decodeWireBody({ dir: 'in', device: 'mount', type: 'set', property: 'P', state: 'Ok', elements: { A: 1, B: true, C: 'x', D: null, E: { nested: 1 } }, perm: 'rw', numbers: { A: { min: 0, max: 1, step: 1, format: '%g' } } })

    expect(wire).toEqual(Option.some({ dir: 'in', device: 'mount', type: 'set', property: 'P', state: 'Ok', elements: { A: 1, B: true, C: 'x' }, numbers: { A: { min: 0, max: 1 } } }))
  })

  it('gives a body without elements or limits empty ones', () => {
    expect(decodeWireBody({ dir: 'in', device: 'box', type: 'del' })).toEqual(Option.some({ dir: 'in', device: 'box', type: 'del', elements: {}, numbers: {} }))
  })

  it('refuses a body without a direction or device', () => {
    expect(decodeWireBody({ device: 'mount', type: 'set' })).toEqual(Option.none())
    expect(decodeWireBody('text')).toEqual(Option.none())
  })
})
