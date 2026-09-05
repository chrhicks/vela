import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { Home } from './routes/home'
import { RigDetail } from './routes/rig-detail'
import { Alignment } from './routes/alignment'
import { Observe } from './routes/observe'
import { Capture } from './routes/capture'
import './styles.css'
import './routes/rig.css'
import { Shell } from './components/app'
import { HomeProvider } from './pages/HomeProvider'

const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    children: [
      { index: true, Component: () => <HomeProvider><Home /></HomeProvider> },
      { path: 'rigs/:rigId', Component: RigDetail },
      { path: 'rigs/:rigId/observe', Component: Observe },
      { path: 'rigs/:rigId/observe/capture', Component: Capture },
      { path: 'rigs/:rigId/observe/alignment', Component: Alignment },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
