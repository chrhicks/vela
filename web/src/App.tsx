import { BrowserRouter, Route, Routes } from 'react-router'

import { ControlsPage } from './routes/controls/ControlsPage.tsx'
import { FramePage } from './routes/inspect/FramePage.tsx'
import { StackPage } from './routes/inspect/StackPage.tsx'
import { LaunchRoutes } from './routes/launch/LaunchRoutes.tsx'
import { RunPage } from './routes/run/RunPage.tsx'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunPage />} />
        <Route path="/launch/*" element={<LaunchRoutes />} />
        <Route path="/controls" element={<ControlsPage />} />
        <Route path="/controls/:area" element={<ControlsPage />} />
        <Route path="/frame/:number" element={<FramePage />} />
        <Route path="/stack" element={<StackPage />} />
      </Routes>

    </BrowserRouter>
  )
}
