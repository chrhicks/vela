/** A controllable adjustment pause that exercises the controller's real cancellation path. */
export function createTestCadence() {
  const waits: Array<() => void> = []

  function wait(signal: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const finish = () => {
        signal.removeEventListener('abort', abort)
        resolve()
      }

      const abort = () => {
        const index = waits.indexOf(finish)

        if (index >= 0) waits.splice(index, 1)
        reject(new DOMException('Stopped', 'AbortError'))
      }

      signal.addEventListener('abort', abort, { once: true })

      if (signal.aborted) abort()
      else waits.push(finish)
    })
  }

  return { waits, wait }
}
