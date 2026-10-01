// Load shared foundations before routes and their approved composition styles.
import './styles.css'
import './routes/rig.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { Home } from './routes/home'
import { RigDetail } from './routes/rig-detail'
import { Alignment } from './routes/alignment'
import { Autofocus } from './routes/autofocus'
import { Observe } from './routes/observe'
import { SavedImages } from './routes/saved-images'
import { Targets } from './routes/targets'
import { Explore } from './routes/explore'
import { Capture } from './routes/capture'
import { Shell } from './components/app'
import { HomeProvider } from './pages/HomeProvider'

import { readAppConfig } from './config'
import { createBrowserAppearance, applyRootAppearance } from './appearance/browser-appearance'
import { AppearanceProvider } from './appearance/AppearanceProvider'

const config = readAppConfig({ VITE_THEME: import.meta.env.VITE_THEME })

const appearance = createBrowserAppearance(window, mode => applyRootAppearance(document, config.theme, mode))

const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    children: [
      {
        index: true,
        Component: () => (
          <HomeProvider>
            <Home />
          </HomeProvider>
        ),
      },
      { path: 'rigs/:rigId', Component: RigDetail },
      { path: 'explore', Component: Explore },
      { path: 'rigs/:rigId/observe', Component: Observe },
      { path: 'rigs/:rigId/observe/targets', Component: Targets },
      { path: 'rigs/:rigId/observe/targets/:targetId', Component: Targets },
      { path: 'rigs/:rigId/observe/capture', Component: Capture },
      { path: 'rigs/:rigId/observe/saved-images', Component: SavedImages },
      { path: 'rigs/:rigId/observe/saved-images/:imageId', Component: SavedImages },
      { path: 'rigs/:rigId/observe/alignment', Component: Alignment },
      { path: 'rigs/:rigId/observe/autofocus', Component: Autofocus },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppearanceProvider appearance={appearance}>
      <RouterProvider router={router} />
    </AppearanceProvider>
  </StrictMode>,
)
