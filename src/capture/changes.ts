export function makeChanges() {
  const listeners = new Set<() => void>()

  return {
    announce() {
      for (const listener of [...listeners]) listener()
    },

    until(check: () => boolean, timeoutMs: number | undefined, signal: AbortSignal): Promise<boolean> {
      if (check()) return Promise.resolve(true)
      if (signal.aborted) return Promise.resolve(false)

      return new Promise(resolve => {
        const finish = (seen: boolean) => {
          clearTimeout(timer)
          listeners.delete(recheck)
          signal.removeEventListener('abort', onAbort)
          resolve(seen)
        }
        const recheck = () => {
          if (check()) finish(true)
        }
        const onAbort = () => finish(false)
        const timer = timeoutMs === undefined ? undefined : setTimeout(() => finish(false), timeoutMs)

        listeners.add(recheck)
        signal.addEventListener('abort', onAbort)
      })
    },
  }
}

export type Changes = ReturnType<typeof makeChanges>
