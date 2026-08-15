import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider, createBrowserRouter } from 'react-router'
import { AppLayout } from './routes/app-layout'
import { ApiExample } from './routes/api-example'
import { Home } from './routes/home'
import './styles.css'

const router = createBrowserRouter([
  {
    path: '/',
    Component: AppLayout,
    children: [
      { index: true, Component: Home },
      { path: 'api', Component: ApiExample },
    ],
  },
])

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
