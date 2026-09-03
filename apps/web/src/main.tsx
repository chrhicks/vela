import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { Home } from './routes/home'
import { RigDetail } from './routes/rig-detail'
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
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
