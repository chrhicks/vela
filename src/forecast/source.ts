import { Data, Effect } from 'effect'
import type { ForecastSettings } from './settings.ts'

export class ForecastUnreachable extends Data.TaggedError('ForecastUnreachable')<{ readonly reason: string }> {}

export class ForecastUnreadable extends Data.TaggedError('ForecastUnreadable')<{}> {}

export interface ForecastSource {
  readonly json: (address: string) => Effect.Effect<unknown, ForecastUnreachable>
}

export const fetchSource = (settings: Pick<ForecastSettings, 'userAgent' | 'requestTimeoutSeconds'>): ForecastSource => ({
  json: address =>
    Effect.tryPromise({
      try: async () => {
        const response = await fetch(address, { signal: AbortSignal.timeout(settings.requestTimeoutSeconds * 1000), headers: { 'User-Agent': settings.userAgent, Accept: 'application/geo+json, application/json' } })

        if (!response.ok) throw new HttpRefused(`HTTP ${response.status}`)

        return await response.json()
      },
      catch: cause => new ForecastUnreachable({ reason: reasonOf(cause) }),
    }),
})

class HttpRefused extends Error {}

const reasonOf = (cause: unknown): string => {
  if (cause instanceof HttpRefused) return cause.message

  return cause instanceof Error && cause.name === 'TimeoutError' ? 'timed out' : 'could not be reached'
}
