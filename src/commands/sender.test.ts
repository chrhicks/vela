import { describe, expect, it } from 'vitest'
import { StreamPosition, type Entry } from '../../state/entry.ts'
import { makeSender, readAnswer } from './sender.ts'

const answer = (body: unknown): Entry => ({ seq: StreamPosition.make(0), kind: 'client.command', at: 1, body })

function setup(options: { timeoutMs?: number; publish?: (subject: string, payload: string) => void } = {}) {
  const published: Array<{ subject: string; payload: Record<string, unknown> }> = []
  let count = 0

  const sender = makeSender({
    subjectOf: device => `rig-test.command.${device}`,
    publish: options.publish ?? ((subject, payload) => void published.push({ subject, payload: JSON.parse(payload) as Record<string, unknown> })),
    newId: () => `vela-${(count += 1)}`,
    answerTimeoutMs: options.timeoutMs ?? 50,
    by: 'vela',
    now: Date.now,
  })

  return { sender, published }
}

const command = { device: 'primary', property: 'CCD_FRAME_TYPE', values: { FRAME_DARK: true } }

describe('the command sender', () => {
  it('publishes the command by id and reports written when the rig program says so', async () => {
    const { sender, published } = setup()
    const outcome = sender.send(command)

    expect(published).toEqual([{ subject: 'rig-test.command.primary', payload: { id: 'vela-1', property: 'CCD_FRAME_TYPE', values: { FRAME_DARK: true }, by: 'vela' } }])
    sender.answered(answer({ id: 'vela-1', by: 'vela', device: 'primary', property: 'CCD_FRAME_TYPE', result: 'written' }))

    expect(await outcome).toEqual({ result: 'written' })
  })

  it('reports a refusal with its reason', async () => {
    const { sender } = setup()
    const outcome = sender.send(command)

    sender.answered(answer({ id: 'vela-1', result: 'refused', reason: 'CCD_FRAME_TYPE is read-only' }))

    expect(await outcome).toEqual({ result: 'refused', reason: 'CCD_FRAME_TYPE is read-only' })
  })

  it('keeps waiting for an answer, lists the command as late after the answer time, and does not publish again', async () => {
    const { sender, published } = setup({ timeoutMs: 5 })
    const outcome = sender.send(command)

    await new Promise(resolve => setTimeout(resolve, 20))

    expect(sender.late(Date.now())).toMatchObject([{ device: 'primary', property: 'CCD_FRAME_TYPE' }])
    sender.answered(answer({ id: 'vela-1', result: 'written' }))

    expect(await outcome).toEqual({ result: 'written' })
    expect(sender.late(Date.now())).toEqual([])
    expect(published).toHaveLength(1)
  })

  it('stops waiting when Stop is pressed', async () => {
    const { sender } = setup()
    const stop = new AbortController()
    const outcome = sender.send(command, stop.signal)

    stop.abort()

    expect(await outcome).toEqual({ result: 'unknown', reason: 'Stop pressed before the rig program answered' })
    expect(sender.late(Date.now() + 1000)).toEqual([])
  })

  it('ignores answers for other ids', async () => {
    const { sender } = setup({ timeoutMs: 5 })
    const stop = new AbortController()
    const outcome = sender.send(command, stop.signal)

    sender.answered(answer({ id: 'someone-else', result: 'written' }))
    await new Promise(resolve => setTimeout(resolve, 20))

    expect(sender.late(Date.now())).toHaveLength(1)
    stop.abort()
    expect(await outcome).toMatchObject({ result: 'unknown' })
  })

  it('refuses when the publish itself throws', async () => {
    const { sender } = setup({
      publish: () => {
        throw new Error('connection closed')
      },
    })

    expect(await sender.send(command)).toEqual({ result: 'refused', reason: 'could not publish: connection closed' })
  })
})

describe('readAnswer', () => {
  it('reads only client.command entries with an id and a result', () => {
    expect(readAnswer(answer({ id: 'a', result: 'written' }))).toEqual({ id: 'a', result: 'written', reason: undefined })
    expect(readAnswer(answer({ id: 'a', result: 'maybe' }))).toBeUndefined()
    expect(readAnswer({ ...answer({ id: 'a', result: 'written' }), kind: 'client.connected' })).toBeUndefined()
  })
})
