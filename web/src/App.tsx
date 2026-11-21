import { BrowserRouter, Route, Routes } from 'react-router'

import { reviewPath } from '../../state/review-answer.ts'
import { ControlsPage } from './routes/controls/ControlsPage.tsx'
import { FramePage } from './routes/inspect/FramePage.tsx'
import { StackPage } from './routes/inspect/StackPage.tsx'
import { HorizonPage } from './routes/horizon/HorizonPage.tsx'
import { LaunchRoutes } from './routes/launch/LaunchRoutes.tsx'
import { ReviewPage } from './routes/review/ReviewPage.tsx'
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
        <Route path="/horizon" element={<HorizonPage />} />
        <Route path="/stack" element={<StackPage />} />
        <Route path={reviewPath} element={<ReviewPage />} />
      </Routes>

    </BrowserRouter>
  )
}
