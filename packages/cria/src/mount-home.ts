/**
 * When each mount last confirmed a home, as far as this Vela process saw. The AM5 reports no at-home
 * state, so this is a record of an operation, not a reading. It lives in memory: a Vela restart
 * forgets it, and so does any move Vela commands or sees begin.
 */
export interface MountHome {
  confirmedAt(telescopeId: string): string | undefined
  confirm(telescopeId: string): void
  forget(telescopeId: string): void
}

export function createMountHome(now: () => Date = () => new Date()): MountHome {
  const confirmed = new Map<string, string>()

  return {
    confirmedAt: telescopeId => confirmed.get(telescopeId),
    confirm: telescopeId => void confirmed.set(telescopeId, now().toISOString()),
    forget: telescopeId => void confirmed.delete(telescopeId),
  }
}
