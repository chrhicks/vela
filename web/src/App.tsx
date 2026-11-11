import { BrowserRouter, Route, Routes } from 'react-router'

import { ControlsPage } from './routes/controls/ControlsPage.tsx'
import { LaunchRoutes } from './routes/launch/LaunchRoutes.tsx'
import { RunPage } from './routes/run/RunPage.tsx'
import { SceneBar } from './stub/SceneBar.tsx'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunPage />} />
        <Route path="/launch/*" element={<LaunchRoutes />} />
        <Route path="/controls" element={<ControlsPage />} />
        <Route path="/controls/:area" element={<ControlsPage />} />
      </Routes>

      <SceneBar />
    </BrowserRouter>
  )
}
