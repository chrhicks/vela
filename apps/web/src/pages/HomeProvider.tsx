import { createContext } from "react";
import type { HomeView } from "@vela/model/web";
import { useState } from "react";

interface HomeContextValue {
  home?: HomeView
  loading: boolean
  error?: string
  refresh(): Promise<void>
}

export const HomeContext = createContext<HomeContextValue | null>(null);

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [home] = useState<HomeContextValue>({
    home: {
      rigs: [
        {
          id: '1',
          name: 'Rig 1',
          reachable: true,
          devices: [
            {
              id: '1',
              rigId: '1',
              name: 'Device 1',
              kind: 'camera',
              driver: { name: 'Camera 1', version: '1.0.0' },
              connection: 'connected',
              status: { state: 'idle' },
              updatedAt: new Date().toISOString(),
            },
            {
              id: '2',
              rigId: '1',
              name: 'Device 2',
              kind: 'telescope',
              driver: { name: 'Telescope 1', version: '1.0.0' },
              connection: 'connected',
              status: { state: 'idle' },
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      ],
      refreshedAt: new Date().toISOString(),
    },
    loading: false,
    refresh() {
      return Promise.resolve()
    },
    
  });
  return (
    <HomeContext.Provider value={home}>
      {children}
    </HomeContext.Provider>
  );
}