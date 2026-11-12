import '@fontsource/inter/latin-400.css'
import '@fontsource/inter/latin-500.css'
import '@fontsource/jetbrains-mono/latin-400.css'
import '@fontsource/jetbrains-mono/latin-500.css'
import '@fontsource/jetbrains-mono/latin-700.css'
import './styles/tokens.css'
import './styles/base.css'

import { Effect } from 'effect'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { feedPath } from '../../state/feed.ts'
import { App } from './App.tsx'
import { followFeed } from './rig/store.ts'

const root = document.getElementById('root')

if (root === null) throw new Error('index.html has no #root element')

Effect.runFork(followFeed(feedPath))

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
