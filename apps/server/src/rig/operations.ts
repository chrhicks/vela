/** A device whose last command has an unknown outcome. Nothing new starts on its Rig until it is recovered. */
export interface RigHold {
  readonly deviceId: string
  readonly reason: string
}

/**
 * A Rig has one command owner until its device work and cleanup finish. A hold
 * outranks that owner: while any device is held, the Rig reports the hold and
 * refuses every new operation.
 */
export function createRigOperations(
  holdsOf: (rigId: string) => ReadonlyArray<RigHold> = () => [],
) {
  const owners = new Map<string, string>()

  function acquire(rigId: string, owner: string): (() => void) | undefined {
    if (holdsOf(rigId).length > 0 || owners.has(rigId)) return undefined
    owners.set(rigId, owner)
    let released = false

    return () => {
      if (released) return
      released = true
      owners.delete(rigId)
    }
  }

  return {
    acquire,
    owner: (rigId: string): RigHold | string | undefined => holdsOf(rigId)[0] ?? owners.get(rigId),
    heldReason: (rigId: string) => holdsOf(rigId)[0]?.reason,
  }
}

export type RigOperations = ReturnType<typeof createRigOperations>
