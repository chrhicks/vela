import { useEffect, useRef, useState } from 'react'
import { Button, IconButton } from '@vela/ui'
import { FIELDROOM_PROFILE, resolveTheme, themeStyle } from '@vela/ui/themes'
import { featureCatalog } from './catalog'
import type { WorkshopFeature } from './definitions'
import { ChoiceMenu } from './ChoiceMenu'
import { BackIcon, ExpandIcon, LinkIcon } from './Icons'
import { FeatureShelf } from './FeatureShelf'
import { featureHref, readSavedSelection, resolvePreview, type PreviewSelection, type SelectedPreview } from './location'
import './workspace.css'

const theme = resolveTheme(FIELDROOM_PROFILE, { density: 1 })

type Navigate = (href: string, replace?: boolean) => void

function recoveredSelection(featureId: string) {
  try {
    return readSavedSelection(localStorage.getItem(`vela.workshop.feature.${featureId}`))
  } catch {
    return undefined
  }
}

export function FeatureWorkspace({ url, navigate }: { url: URL; navigate: Navigate }) {
  const match = /^\/features\/([^/]+)\/?$/.exec(url.pathname)
  const feature = match ? featureCatalog.find(item => encodeURIComponent(item.id) === match[1]) : undefined
  const location = feature ? resolvePreview(feature, url.searchParams, recoveredSelection(feature.id)) : undefined
  const shelf = url.pathname === '/' || url.pathname === '/features'

  return (
    <div className="vela-theme feature-workspace" data-mode="light" style={themeStyle(theme, 'light')}>
      {shelf ? <FeatureShelf navigate={navigate} /> : feature && location?.ok ? (
        <FeaturePreview key={feature.id} feature={feature} preview={location.preview} navigate={navigate} />
      ) : (
        <main className="feature-unavailable">
          <p>Vela Workshop</p>
          <h1>Preview unavailable</h1>
          <p>{location && !location.ok ? location.message : 'This feature is not available in the workshop.'}</p>
          {feature && <Button onClick={() => navigate(featureHref(feature.id, {
            designId: feature.defaultDesign,
            scenarioId: feature.designs.find(item => item.id === feature.defaultDesign)!.defaultScenario,
            mode: 'light', viewport: 'fit',
          }))}>Open default preview</Button>}
          <Button tone="quiet" onClick={() => navigate('/')}>Back to Features</Button>
        </main>
      )}
    </div>
  )
}

function FeaturePreview({ feature, preview, navigate }: {
  feature: WorkshopFeature
  preview: SelectedPreview
  navigate: Navigate
}) {
  const { selection, design, scenario } = preview
  const [reset, setReset] = useState(0)
  const [focused, setFocused] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'fallback'>('idle')
  const [shareLink, setShareLink] = useState('')
  const surface = useRef<HTMLDivElement>(null)
  const focusTrigger = useRef<HTMLSpanElement>(null)
  const returnButton = useRef<HTMLSpanElement>(null)
  const [width, setWidth] = useState(0)

  useEffect(() => {
    const href = featureHref(feature.id, selection)

    try {
      localStorage.setItem(`vela.workshop.feature.${feature.id}`, JSON.stringify(selection))
    } catch {
      // The URL remains usable when browser storage is disabled.
    }

    if (`${window.location.pathname}${window.location.search}` !== href) navigate(href, true)
  }, [feature.id, selection.designId, selection.scenarioId, selection.mode, selection.viewport])

  useEffect(() => {
    const element = surface.current

    if (!element) return

    const observer = new ResizeObserver(() => setWidth(Math.round(element.getBoundingClientRect().width)))
    observer.observe(element)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    setCopyState('idle')
  }, [selection.designId, selection.scenarioId, selection.mode, selection.viewport])

  useEffect(() => {
    if (copyState !== 'copied') return

    const timer = window.setTimeout(() => setCopyState('idle'), 2400)

    return () => window.clearTimeout(timer)
  }, [copyState])

  useEffect(() => {
    if (!focused) return

    returnButton.current?.querySelector('button')?.focus()

    function escape(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role="dialog"]')) return

      setFocused(false)
      requestAnimationFrame(() => focusTrigger.current?.querySelector('button')?.focus())
    }

    window.addEventListener('keydown', escape)

    return () => window.removeEventListener('keydown', escape)
  }, [focused])

  function change(patch: Partial<PreviewSelection>) {
    navigate(featureHref(feature.id, { ...selection, ...patch }))
  }

  async function copyLink() {
    const measuredWidth = selection.viewport === 'fit' ? Math.max(320, Math.min(1920, width)) : selection.viewport
    const href = new URL(featureHref(feature.id, { ...selection, viewport: measuredWidth }), window.location.origin).href
    setShareLink(href)

    try {
      await navigator.clipboard.writeText(href)
      setCopyState('copied')
    } catch {
      setCopyState('fallback')
    }
  }

  return (
    <div className={`feature-preview${focused ? ' feature-preview--focused' : ''}`}>
      {!focused && <header className="feature-toolbar">
        <div className="feature-toolbar-heading">
          <Button tone="quiet" leadingIcon={<BackIcon />} onClick={() => navigate('/')}>Features</Button>
          <span className="feature-toolbar-divider" />
          <h1>{feature.label}</h1>
          {feature.designs.length > 1 && <ChoiceMenu
            label="Design" title="Choose a design" value={design.id} choices={feature.designs}
            onSelect={id => {
              const next = feature.designs.find(item => item.id === id)!
              change({ designId: id, scenarioId: next.scenarios.some(item => item.id === scenario.id) ? scenario.id : next.defaultScenario })
            }}
          />}
        </div>
        <div className="feature-toolbar-controls">
          <ChoiceMenu label="Width" title="Preview width" value={String(selection.viewport)}
            choices={[
              { id: 'fit', label: 'Fit', description: 'Use the available space.' },
              { id: '390', label: 'Phone · 390 px' },
              { id: '1280', label: 'Desktop · 1280 px' },
              ...(selection.viewport !== 'fit' && selection.viewport !== 390 && selection.viewport !== 1280
                ? [{ id: String(selection.viewport), label: `${selection.viewport} px`, description: 'Width from this preview link.' }]
                : []),
            ]}
            onSelect={viewport => change({ viewport: viewport === 'fit' ? 'fit' : Number(viewport) })} />
          <ChoiceMenu label="Appearance" title="Preview appearance" value={selection.mode}
            choices={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]}
            onSelect={mode => change({ mode: mode === 'dark' ? 'dark' : 'light' })} />
          <ChoiceMenu label="Start from" title="Choose a starting scenario" value={scenario.id} choices={design.scenarios}
            footer="Scenarios set the starting point. Interact with the preview from there."
            onSelect={scenarioId => {
              setReset(value => value + 1)
              change({ scenarioId })
            }} />
          <Button tone="quiet" onClick={() => setReset(value => value + 1)}>Reset</Button>
          <Button tone="quiet" leadingIcon={<LinkIcon />} onClick={() => void copyLink()}>{copyState === 'copied' ? 'Copied' : 'Copy link'}</Button>
          <span ref={focusTrigger}><IconButton tone="quiet" label="Focus preview" icon={<ExpandIcon />} onClick={() => setFocused(true)} /></span>
        </div>
      </header>}
      {!focused && <div className="feature-preview-context">
        <details>
          <summary>About this design</summary>
          <div><p>{design.intent}</p>{scenario.tryThis && <p><strong>Try this</strong> {scenario.tryThis}</p>}</div>
        </details>
        <span>{selection.viewport === 'fit' ? 'Fit' : `${selection.viewport} px`} · Interactive preview</span>
      </div>}
      {copyState === 'fallback' && !focused && <div className="feature-share-fallback">
        <label htmlFor="feature-share-link">Copy this link to reopen the same starting scenario:</label>
        <input id="feature-share-link" value={shareLink} readOnly onFocus={event => event.currentTarget.select()} />
        <Button tone="quiet" onClick={() => setCopyState('idle')}>Close</Button>
      </div>}
      {focused && <span className="feature-focus-return" ref={returnButton}><Button leadingIcon={<BackIcon />} onClick={() => {
        setFocused(false)
        requestAnimationFrame(() => focusTrigger.current?.querySelector('button')?.focus())
      }}>Return to workshop</Button></span>}
      <div className={`feature-preview-stage${selection.viewport === 'fit' ? ' feature-preview-stage--fit' : ''}`}>
        <div ref={surface} className="vela-theme feature-preview-surface" data-mode={selection.mode}
          style={{ ...themeStyle(theme, selection.mode), width: selection.viewport === 'fit' ? '100%' : selection.viewport }}>
          <div key={`${design.id}:${scenario.id}:${reset}`} className="feature-preview-content">{scenario.render()}</div>
        </div>
      </div>
      <span className="feature-sr-only" role="status">{copyState === 'copied' ? 'Preview link copied' : ''}</span>
    </div>
  )
}
