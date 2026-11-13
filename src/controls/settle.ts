import { Duration, Effect, Option, Result, Stream } from 'effect'
import type { DeviceName } from '../../state/devices.ts'
import { readRigEntry } from '../../state/entries.ts'
import type { Entry, PropertyState } from '../../state/entry.ts'

const stateOf =
  (device: DeviceName, property: string) =>
  (entry: Entry): Result.Result<PropertyState, Entry> =>
    Result.match(readRigEntry(entry), {
      onFailure: () => Result.fail(entry),
      onSuccess: found => {
        const rigEntry = Option.getOrUndefined(found)
        const state = rigEntry?.kind === 'wire' && rigEntry.body.dir === 'in' && rigEntry.body.device === device && rigEntry.body.property === property ? rigEntry.body.state : undefined

        return state === undefined ? Result.fail(entry) : Result.succeed(state)
      },
    })

interface Settling {
  readonly seenBusy: boolean
  readonly ended: Option.Option<PropertyState>
}

const within = (seconds: number) => <A>(waiting: Effect.Effect<Option.Option<A>>) => waiting.pipe(Effect.timeoutOption(Duration.seconds(seconds)), Effect.map(Option.flatten))

export const endOfMove = (entries: Stream.Stream<Entry>, device: DeviceName, property: string, seconds: number): Effect.Effect<Option.Option<PropertyState>> =>
  entries.pipe(
    Stream.filterMap(stateOf(device, property)),
    Stream.scan(
      (): Settling => ({ seenBusy: false, ended: Option.none() }),
      (was, state): Settling => {
        const seenBusy = was.seenBusy || state === 'Busy'

        return { seenBusy, ended: seenBusy && state !== 'Busy' ? Option.some(state) : Option.none() }
      },
    ),
    Stream.filter(settling => Option.isSome(settling.ended)),
    Stream.runHead,
    Effect.map(Option.flatMap(settling => settling.ended)),
    within(seconds),
  )

export const nextIdle = (entries: Stream.Stream<Entry>, device: DeviceName, property: string, seconds: number): Effect.Effect<Option.Option<PropertyState>> =>
  entries.pipe(
    Stream.filterMap(stateOf(device, property)),
    Stream.filter(state => state !== 'Busy'),
    Stream.runHead,
    within(seconds),
  )
