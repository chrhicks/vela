import { useEffect, useState } from 'react'

export function useAsked<Answer>(ask: () => Promise<Answer>, key: string, again: number): Answer | undefined {
  const [held, setHeld] = useState<{ readonly key: string; readonly answer: Answer } | undefined>(undefined)

  useEffect(() => {
    let current = true

    void ask().then(answer => {
      if (current) setHeld({ key, answer })
    })

    return () => {
      current = false
    }
  }, [key, again])

  return held?.key === key ? held.answer : undefined
}
