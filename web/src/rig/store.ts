import { Effect, Match, Result, Stream } from 'effect'
import { useSyncExternalStore } from 'react'
import type { NightName } from '../../../state/entries.ts'
import type { LinkLimits, StartToken } from '../../../state/feed.ts'
import { advance, emptyRig, type RigState } from '../../../state/rig.ts'
import { feedEvents, type FeedEvent } from './feed.ts'

export interface Beat {
  readonly at: number
  readonly receivedAt: number
}

export interface Link {
  readonly status: 'connecting' | 'open' | 'lost'
  readonly beat: Beat | undefined
  readonly limits: LinkLimits | undefined
  readonly night: NightName | undefined
  readonly openedAt: number
}

interface Store {
  readonly startToken: StartToken | undefined
  readonly rig: RigState
  readonly link: Link
}

let store: Store = { startToken: undefined, rig: emptyRig, link: { status: 'connecting', beat: undefined, limits: undefined, night: undefined, openedAt: Date.now() } }

const changeListeners = new Set<() => void>()

const updateStore = (change: (current: Store) => Store) =>
  Effect.sync(() => {
    store = change(store)
    for (const listener of changeListeners) listener()
  })

const reloadPage = Effect.sync(() => window.location.reload())

const logProblem = (line: string) => Effect.sync(() => console.error(`vela: ${line}`))

const applyFeedEvent = (event: FeedEvent): Effect.Effect<void> =>
  Match.valueTags(event, {
    State: ({ bootstrap, receivedAt }) =>
      Effect.suspend(() =>
        store.startToken !== undefined && store.startToken !== bootstrap.token
          ? reloadPage
          : updateStore(current => ({ startToken: bootstrap.token, rig: bootstrap.state, link: { ...current.link, status: 'open', limits: bootstrap.limits, night: bootstrap.night, beat: { at: bootstrap.at, receivedAt } } })),
      ),
    Entry: ({ entry }) =>
      Effect.suspend(() => Effect.fromResult(advance(store.rig, entry))).pipe(
        Effect.flatMap(rig => updateStore(current => ({ ...current, rig }))),
        Effect.catchTag('MalformedEntry', error => logProblem(`${error.kind} #${error.seq} is malformed: ${error.issue}`)),
      ),
    Heartbeat: ({ at, night, receivedAt }) => updateStore(current => ({ ...current, link: { ...current.link, night, beat: { at, receivedAt } } })),
    Lost: () => updateStore(current => ({ ...current, link: { ...current.link, status: 'lost' } })),
  })

export const followFeed = (address: string): Effect.Effect<void> =>
  feedEvents(address).pipe(
    Stream.runForEach(read =>
      Result.match(read, {
        onSuccess: applyFeedEvent,
        onFailure: error => Match.valueTags(error, { FeedUnreadable: ({ event, issue }) => logProblem(`a ${event} message could not be read: ${issue}`) }),
      }),
    ),
  )

const subscribe = (listener: () => void) => {
  changeListeners.add(listener)

  return () => void changeListeners.delete(listener)
}

export const useRig = <Slice>(select: (rig: RigState) => Slice): Slice => useSyncExternalStore(subscribe, () => select(store.rig))

export const useLink = (): Link => useSyncExternalStore(subscribe, () => store.link)
