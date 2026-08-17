import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { ApiExample } from './routes/api-example'
import { Home } from './routes/home'
import './styles.css'
import { Shell } from './components/app'
import { HomeProvider } from './pages/HomeProvider'

const router = createBrowserRouter([
  {
    path: '/',
    Component: Shell,
    children: [
      { index: true, Component: () => <HomeProvider><Home /></HomeProvider> },
      { path: 'api', Component: ApiExample },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
