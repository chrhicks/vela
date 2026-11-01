import { epochMs, type EpochMs } from '@vela/rig-events'

/** Reads an ISO instant, or undefined when the text is not one. */
export function instantOf(text: string): EpochMs | undefined {
  const ms = Date.parse(text)

  return Number.isSafeInteger(ms) && ms >= 0 ? epochMs(ms) : undefined
}

export const isoOf = (at: EpochMs): string => new Date(at).toISOString()
