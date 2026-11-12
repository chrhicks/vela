import { useEffect, useState } from 'react'

export function useLocalNow(everyMilliseconds: number): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMilliseconds)

    return () => window.clearInterval(timer)
  }, [everyMilliseconds])

  return now
}
