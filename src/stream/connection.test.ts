import { describe, expect, it } from 'vitest'
import { makeConnectionFinder } from './connection.ts'

const line = (kind: string, run: string) => JSON.stringify({ v: 2, id: `${kind}:${run}`, kind, at: 1, run, body: { run } })

describe('makeConnectionFinder', () => {
  it('starts at the latest client.connected, not the first', () => {
    const finder = makeConnectionFinder()

    finder.take(10, line('client.connected', 'a'))
    finder.take(11, line('client.protocol-problem', 'a'))
    finder.take(40, line('client.connected', 'b'))
    finder.take(41, line('client.connection', 'b'))

    expect(finder.start()).toBe(40)
  })

  it('has no start when the stream holds no connection', () => {
    const finder = makeConnectionFinder()

    finder.take(3, line('client.protocol-problem', 'a'))
    finder.take(4, 'not json')

    expect(finder.start()).toBeUndefined()
  })
})
