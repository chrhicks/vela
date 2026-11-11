import { BrowserRouter, Route, Routes } from 'react-router'

import { ControlsPage } from './routes/controls/ControlsPage.tsx'
import { LaunchPage } from './routes/launch/LaunchPage.tsx'
import { RunPage } from './routes/run/RunPage.tsx'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<RunPage />} />
        <Route path="/launch" element={<LaunchPage />} />
        <Route path="/controls" element={<ControlsPage />} />
      </Routes>
    </BrowserRouter>
  )
}
