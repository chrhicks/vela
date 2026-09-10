import type { HomeView } from '@vela/model/web'
import { createContext, useEffect, useRef, useState } from 'react'
import { loadHome } from '../features/home/load-home'

interface HomeContextValue {
  home?: HomeView
  loading: boolean
  error?: string
  refresh(): Promise<void>
}

export const HomeContext = createContext<HomeContextValue | null>(null)

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [homeView, setHomeView] = useState<HomeView | null>(null)
  const [loading, setLoading] = useState(true)
  const initialLoadStarted = useRef(false)
  const requestGeneration = useRef(0)
  const [error, setError] = useState<string>()

  async function fetchHomeView() {
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(undefined)

    try {
      const response = await loadHome()

      if (requestGeneration.current === generation) setHomeView(response)
    } catch {
      if (requestGeneration.current !== generation) return

      setError(homeView === null
        ? 'Vela could not load your rigs. Check the server and try again.'
        : 'Vela could not refresh your rigs. Showing the previous state.')
    } finally {
      if (requestGeneration.current === generation) setLoading(false)
    }
  }

  useEffect(() => {
    if (initialLoadStarted.current) return

    initialLoadStarted.current = true
    void fetchHomeView()
  }, [])

  return (
    <HomeContext.Provider value={{
      home: homeView ?? undefined,
      loading,
      error,
      refresh: fetchHomeView,
    }}>
      {children}
    </HomeContext.Provider>
  )
}
