import { Effect, Match, Result, Stream } from 'effect'
import { useSyncExternalStore } from 'react'
import type { StartToken } from '../../../state/feed.ts'
import { advance, emptyRig, type RigState } from '../../../state/rig.ts'
import { feedEvents, type FeedEvent } from './feed.ts'

export interface Beat {
  readonly at: number
  readonly receivedAt: number
}

export interface Link {
  readonly status: 'connecting' | 'open' | 'lost'
  readonly beat: Beat | undefined
}

interface Held {
  readonly token: StartToken | undefined
  readonly rig: RigState
  readonly link: Link
}

let held: Held = { token: undefined, rig: emptyRig, link: { status: 'connecting', beat: undefined } }

const listeners = new Set<() => void>()

const hold = (next: Held) =>
  Effect.sync(() => {
    held = next
    for (const listener of listeners) listener()
  })

const report = (line: string) => Effect.sync(() => console.error(`vela: ${line}`))

const take = (event: FeedEvent): Effect.Effect<void> =>
  Match.valueTags(event, {
    State: ({ bootstrap }) =>
      held.token !== undefined && held.token !== bootstrap.token
        ? Effect.sync(() => window.location.reload())
        : hold({ token: bootstrap.token, rig: bootstrap.state, link: { status: 'open', beat: held.link.beat } }),
    Entry: ({ entry }) =>
      Effect.fromResult(advance(held.rig, entry)).pipe(
        Effect.flatMap(rig => hold({ ...held, rig })),
        Effect.catchTag('MalformedEntry', error => report(`${error.kind} #${error.seq} is malformed: ${error.issue}`)),
      ),
    Heartbeat: ({ at, receivedAt }) => hold({ ...held, link: { ...held.link, beat: { at, receivedAt } } }),
    Lost: () => hold({ ...held, link: { ...held.link, status: 'lost' } }),
  })

export const followFeed = (address: string): Effect.Effect<void> =>
  feedEvents(address).pipe(
    Stream.runForEach(read =>
      Result.match(read, {
        onSuccess: take,
        onFailure: error => Match.valueTags(error, { FeedUnreadable: ({ event, issue }) => report(`a ${event} message could not be read: ${issue}`) }),
      }),
    ),
  )

const subscribe = (listener: () => void) => {
  listeners.add(listener)

  return () => void listeners.delete(listener)
}

export const useRig = <Slice>(select: (rig: RigState) => Slice): Slice => useSyncExternalStore(subscribe, () => select(held.rig))

export const useLink = (): Link => useSyncExternalStore(subscribe, () => held.link)
