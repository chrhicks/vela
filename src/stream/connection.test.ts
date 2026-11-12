import { describe, expect, it } from 'vitest'
import { makeConnectionFinder } from './connection.ts'

const line = (seq: number, kind: string, run: string) => ({ seq, subject: 'rig-dev.client', time: 1, text: JSON.stringify({ v: 2, id: `${kind}:${run}`, kind, at: 1, run, body: { run } }) })

describe('makeConnectionFinder', () => {
  it('starts at the latest client.connected, not the first', () => {
    const finder = makeConnectionFinder()

    finder.take(line(10, 'client.connected', 'a'))
    finder.take(line(11, 'client.protocol-problem', 'a'))
    finder.take(line(40, 'client.connected', 'b'))
    finder.take(line(41, 'client.connection', 'b'))

    expect(finder.start()).toBe(40)
  })

  it('has no start when the stream holds no connection', () => {
    const finder = makeConnectionFinder()

    finder.take(line(3, 'client.protocol-problem', 'a'))
    finder.take({ seq: 4, subject: 'rig-dev.client', time: 1, text: 'not json' })

    expect(finder.start()).toBeUndefined()
  })
})
