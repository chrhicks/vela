import { Effect, Schema } from 'effect'
import { RememberedAnswer, rememberedPath } from '../../../state/remembered.ts'
import { SkyAnswer, skyPath, type Sky } from '../../../state/sky.ts'
import { bestPlacedPath, TargetFacts, targetPath, TargetsFound, targetsPath, type TargetFound } from '../../../state/targets.ts'

export type Listing = { readonly status: 'listed'; readonly targets: ReadonlyArray<TargetFound> } | { readonly status: 'unreachable' }

export type FactsAnswer = { readonly status: 'found'; readonly facts: TargetFacts } | { readonly status: 'unknown' } | { readonly status: 'unreachable' }

export type SkyReading = { readonly status: 'read'; readonly sky: Sky | null } | { readonly status: 'unreachable' }

export type Recalled = { readonly status: 'recalled'; readonly remembered: RememberedAnswer } | { readonly status: 'unreachable' }

const unknownStatus = 404

const asked = (address: string) => Effect.tryPromise(() => fetch(address))

const bodyOf = (response: Response) => Effect.tryPromise(() => response.json())

const listing = (address: string): Effect.Effect<Listing> =>
  asked(address).pipe(
    Effect.flatMap(bodyOf),
    Effect.flatMap(Schema.decodeUnknownEffect(TargetsFound)),
    Effect.map((targets): Listing => ({ status: 'listed', targets })),
    Effect.catchTags({ UnknownError: () => Effect.succeed<Listing>({ status: 'unreachable' }), SchemaError: () => Effect.succeed<Listing>({ status: 'unreachable' }) }),
  )

const facts = (id: string): Effect.Effect<FactsAnswer> =>
  asked(`${targetPath}?id=${encodeURIComponent(id)}`).pipe(
    Effect.flatMap(response =>
      response.status === unknownStatus
        ? Effect.succeed<FactsAnswer>({ status: 'unknown' })
        : bodyOf(response).pipe(
            Effect.flatMap(Schema.decodeUnknownEffect(TargetFacts)),
            Effect.map((found): FactsAnswer => ({ status: 'found', facts: found })),
          ),
    ),
    Effect.catchTags({ UnknownError: () => Effect.succeed<FactsAnswer>({ status: 'unreachable' }), SchemaError: () => Effect.succeed<FactsAnswer>({ status: 'unreachable' }) }),
  )

const sky: Effect.Effect<SkyReading> = asked(skyPath).pipe(
  Effect.flatMap(bodyOf),
  Effect.flatMap(Schema.decodeUnknownEffect(SkyAnswer)),
  Effect.map((read): SkyReading => ({ status: 'read', sky: read })),
  Effect.catchTags({ UnknownError: () => Effect.succeed<SkyReading>({ status: 'unreachable' }), SchemaError: () => Effect.succeed<SkyReading>({ status: 'unreachable' }) }),
)

export const findTargets = (text: string): Promise<Listing> => Effect.runPromise(listing(`${targetsPath}?q=${encodeURIComponent(text)}`))

export const bestPlacedTargets = (): Promise<Listing> => Effect.runPromise(listing(bestPlacedPath))

export const targetFacts = (id: string): Promise<FactsAnswer> => Effect.runPromise(facts(id))

export const skyTonight = (): Promise<SkyReading> => Effect.runPromise(sky)

const remembered: Effect.Effect<Recalled> = asked(rememberedPath).pipe(
  Effect.flatMap(bodyOf),
  Effect.flatMap(Schema.decodeUnknownEffect(RememberedAnswer)),
  Effect.map((answer): Recalled => ({ status: 'recalled', remembered: answer })),
  Effect.catchTags({ UnknownError: () => Effect.succeed<Recalled>({ status: 'unreachable' }), SchemaError: () => Effect.succeed<Recalled>({ status: 'unreachable' }) }),
)

export const rememberedNow = (): Promise<Recalled> => Effect.runPromise(remembered)
