import { Navigate, Route, Routes } from 'react-router'

import { AlignStep } from './AlignStep.tsx'
import { BringUpStep } from './BringUpStep.tsx'
import { FilterStep } from './FilterStep.tsx'
import { FocusStep } from './FocusStep.tsx'
import { ReadyStep } from './ReadyStep.tsx'
import { SetUpStep } from './SetUpStep.tsx'

export function LaunchRoutes() {
  return (
    <Routes>
      <Route index element={<Navigate to="set-up" replace />} />
      <Route path="set-up" element={<SetUpStep />} />
      <Route path="bring-up" element={<BringUpStep />} />
      <Route path="align" element={<AlignStep />} />
      <Route path="filter" element={<FilterStep />} />
      <Route path="focus" element={<FocusStep />} />
      <Route path="ready" element={<ReadyStep />} />
    </Routes>
  )
}
