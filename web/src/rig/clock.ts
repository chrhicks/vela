import { useEffect, useState } from 'react'

export function useLocalNow(everyMilliseconds: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMilliseconds)

    return () => window.clearInterval(timer)
  }, [everyMilliseconds])

  return now
}

export const clockTime = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

export const clockSeconds = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
