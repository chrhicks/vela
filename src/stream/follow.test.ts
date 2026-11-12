import { Effect, Stream } from 'effect'
import { describe, expect, it } from 'vitest'
import { withCaughtUp, type Followed, type Pending } from './follow.ts'

const pending = (seq: number, left: number): Pending => ({ message: { seq, subject: 'rig-test.client', time: seq, text: '{}' }, pending: left })

const marks = (caughtAtStart: boolean, messages: ReadonlyArray<Pending>) =>
  Effect.runPromise(Stream.runCollect(Stream.fromIterable(messages).pipe(withCaughtUp(caughtAtStart)))).then(followed =>
    followed.map((item: Followed) => (item._tag === 'Message' ? item.message.seq : 'caught up')),
  )

describe('withCaughtUp', () => {
  it('marks the point the replay reaches the end of the stream, once', async () => {
    expect(await marks(false, [pending(1, 2), pending(2, 1), pending(3, 0), pending(4, 0)])).toEqual([1, 2, 3, 'caught up', 4])
  })

  it('marks it before anything when there was nothing to replay', async () => {
    expect(await marks(true, [pending(7, 0)])).toEqual(['caught up', 7])
  })
})
