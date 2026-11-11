import { useEffect } from 'react'
import { useNavigate } from 'react-router'

export function useStubAdvance(to: string | undefined, afterSeconds: number) {
  const navigate = useNavigate()

  useEffect(() => {
    if (to === undefined) return

    const timer = setTimeout(() => navigate(to), afterSeconds * 1000)

    return () => clearTimeout(timer)
  }, [to, afterSeconds, navigate])
}
