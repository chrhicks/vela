/** A Rig has one command owner until its device work and cleanup finish. */
export function createRigOperations() {
  const owners = new Map<string, string>()

  function acquire(rigId: string, owner: string): (() => void) | undefined {
    if (owners.has(rigId)) return undefined
    owners.set(rigId, owner)
    let released = false
    return () => {
      if (released) return
      released = true
      owners.delete(rigId)
    }
  }

  return { acquire, owner: (rigId: string) => owners.get(rigId) }
}

export type RigOperations = ReturnType<typeof createRigOperations>
