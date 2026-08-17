import { createContext, useEffect } from "react";
import type { HomeView } from "@vela/model/web";
import { useState } from "react";
import { api } from "../lib/api";

interface HomeContextValue {
  home?: HomeView
  loading: boolean
  error?: string
  refresh(): Promise<void>
}

export const HomeContext = createContext<HomeContextValue | null>(null);

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [homeView, setHomeView] = useState<HomeView | null> (null)
  const [loading, setLoading] = useState<boolean>(false)

  async function fetchHomeView() {
    setLoading(true)
    const response = await api<HomeView>('web/home')
    setHomeView(response)
    setLoading(false)
  }

  useEffect(() => {
    fetchHomeView()
  }, [])

  function refresh() {
    return fetchHomeView()
  }

  return (
    <HomeContext.Provider value={({
      home: homeView ?? undefined,
      loading,
      refresh
    })}>
      {children}
    </HomeContext.Provider>
  );
}