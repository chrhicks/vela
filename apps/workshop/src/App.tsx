import { useEffect, useState } from 'react'
import { BASELINE_FINGERPRINT } from '@vela/ui/themes'
import { Gallery } from './Gallery'
import { componentGroups } from './registry'
import { PreviewCanvas } from './PreviewCanvas'
import { ThemeEditor } from './ThemeEditor'
import { useWorkshop } from './useWorkshop'

const viewportPresets = [
  { label: 'Phone', value: 390 },
  { label: 'Compact', value: 768 },
  { label: 'Wide', value: 1120 },
]

export function App() {
  const workshop = useWorkshop()
  const [copyLabel, setCopyLabel] = useState('Copy context')
  const [pathname, setPathname] = useState(window.location.pathname)
  const unsavedCount = Object.keys(workshop.session.unsavedOverrides).length
  const baselineDrift = workshop.activeProfile.baselineFingerprint !== BASELINE_FINGERPRINT
  const isGallery = pathname === '/gallery'

  useEffect(() => {
    const updatePath = () => setPathname(window.location.pathname)
    window.addEventListener('popstate', updatePath)
    return () => window.removeEventListener('popstate', updatePath)
  }, [])

  function navigate(path: '/' | '/gallery') {
    window.history.pushState(null, '', `${path}${window.location.search}`)
    setPathname(path)
  }

  function openSpecimen(componentId: string, specimenId: string) {
    workshop.selectSpecimen(componentId, specimenId)
    navigate('/')
  }

  function openComposition(componentId: string, specimenId: string, context: typeof workshop.session.context) {
    workshop.selectSpecimen(componentId, specimenId)
    workshop.patchSession({ context })
    navigate('/')
  }

  async function copyContext() {
    const context = {
      url: window.location.href,
      component: workshop.specimen.componentName,
      componentId: workshop.specimen.componentId,
      specimen: workshop.specimen.name,
      specimenId: workshop.specimen.id,
      profile: workshop.activeProfile.name,
      profileId: workshop.activeProfile.id,
      baseline: workshop.activeProfile.baselineId,
      baselineFingerprint: workshop.activeProfile.baselineFingerprint,
      mode: workshop.session.mode,
      density: workshop.session.density,
      viewport: workshop.session.viewport,
      context: workshop.session.context,
      props: workshop.session.props,
      unsavedOverrides: workshop.session.unsavedOverrides,
    }
    await navigator.clipboard.writeText(`Vela workshop context\n${JSON.stringify(context, null, 2)}`)
    setCopyLabel('Copied')
    window.setTimeout(() => setCopyLabel('Copy context'), 1400)
  }

  async function saveAs() {
    const name = window.prompt('Name this design profile', 'Field Draft')?.trim()
    if (!name) return
    try {
      await workshop.saveAs(name)
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to save profile')
    }
  }

  if (!workshop.hydrated) {
    return <main className="loading-screen"><div className="brand-mark">V</div><p>{workshop.status}</p></main>
  }

  return (
    <div className={`workshop-shell ${isGallery ? 'workshop-shell--gallery' : ''}`}>
      <header className="topbar">
        <div className="topbar__identity">
          <div className="brand-lockup">
            <div className="brand-mark">V</div>
            <div><strong>Component Workshop</strong><span>Vela UI · local source</span></div>
          </div>
          <nav className="view-switch" aria-label="Workshop view">
            <button className={!isGallery ? 'active' : ''} onClick={() => navigate('/')}>Workbench</button>
            <button className={isGallery ? 'active' : ''} onClick={() => navigate('/gallery')}>Gallery</button>
          </nav>
        </div>
        <div className="topbar__controls">
          {isGallery ? <select className="gallery-profile" onChange={(event) => workshop.selectProfile(event.target.value)} value={workshop.activeProfile.id}>{workshop.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.readonly ? ' · reference' : ''}</option>)}</select> : null}
          {!isGallery ? <div className="segmented" title="Preview mode">
            {(['dark', 'light'] as const).map((mode) => <button className={workshop.session.mode === mode ? 'active' : ''} key={mode} onClick={() => workshop.patchSession({ mode })}>{mode}</button>)}
          </div> : null}
          <label className="density-control"><span>Density</span><input max={1.25} min={0.75} onChange={(event) => workshop.patchSession({ density: Number(event.target.value) })} step={0.01} type="range" value={workshop.session.density} /><output>{Math.round(workshop.session.density * 100)}%</output></label>
          {!isGallery ? <>
            <button className="button button--quiet" disabled={!workshop.undoCount} onClick={workshop.undo}>Undo <kbd>⌘Z</kbd></button>
            <button className="button button--quiet" disabled={!workshop.redoCount} onClick={workshop.redo}>Redo</button>
            <button className="button" onClick={() => void copyContext()}>{copyLabel}</button>
          </> : null}
        </div>
      </header>

      {isGallery ? (
        <Gallery
          density={workshop.session.density}
          onOpenComposition={openComposition}
          onOpenSpecimen={openSpecimen}
          profileName={workshop.activeProfile.name}
          baselineDrift={baselineDrift}
          theme={workshop.theme}
        />
      ) : <>

      <aside className="library-panel">
        <div className="panel-heading"><span>Component library</span><em>{componentGroups.length}</em></div>
        <div className="component-list">
          {componentGroups.map((group) => (
            <div key={group.id}>
              <button className={`component-item ${workshop.session.componentId === group.id ? 'active' : ''}`} onClick={() => workshop.selectSpecimen(group.id, group.specimens[0]?.id ?? '')}>
                <span className="component-icon">{group.name.slice(0, 1)}</span>
                <span><strong>{group.name}</strong><small><b data-stability={group.stability}>{group.stability}</b> · {group.specimens.length} specimen{group.specimens.length === 1 ? '' : 's'}</small></span>
              </button>
              {workshop.session.componentId === group.id && group.specimens.length > 1 ? group.specimens.map((entry) => <button className="specimen-item" key={entry.id} onClick={() => workshop.selectSpecimen(group.id, entry.id)}>{entry.name}</button>) : null}
            </div>
          ))}
        </div>
        <div className="library-note"><span>Source boundaries</span><code>components/ · stable</code><code>drafts/ · experimental</code><p>Both refresh directly through Vite HMR.</p></div>
      </aside>

      <main className="stage">
        <div className="stage-toolbar">
          <div>
            <div className="eyebrow">{workshop.specimen.componentName} / {workshop.specimen.id}</div>
            <h1>{workshop.specimen.name}</h1>
            <p>{workshop.specimen.description}</p>
          </div>
          <div className="stage-toolbar__actions">
            <label>Context<select onChange={(event) => workshop.patchSession({ context: event.target.value as typeof workshop.session.context })} value={workshop.session.context}><option value="isolated">Isolated</option><option value="form">Form / settings</option><option value="toolbar">Toolbar / action row</option><option value="card">Card / data list</option></select></label>
            <label className="toggle"><input checked={workshop.session.compareBaseline} onChange={(event) => workshop.patchSession({ compareBaseline: event.target.checked })} type="checkbox" /><span /> Compare baseline</label>
          </div>
        </div>

        <div className="viewport-toolbar">
          <div className="segmented">
            {viewportPresets.map((preset) => <button className={workshop.session.viewport === preset.value ? 'active' : ''} key={preset.value} onClick={() => workshop.patchSession({ viewport: preset.value })}>{preset.label}</button>)}
          </div>
          <input aria-label="Preview width" max={1280} min={320} onChange={(event) => workshop.patchSession({ viewport: Number(event.target.value) })} step={1} type="range" value={workshop.session.viewport} />
          <output>{workshop.session.viewport}px</output>
        </div>

        <div className="canvas-scroll">
          <PreviewCanvas
            compare={workshop.session.compareBaseline}
            mode={workshop.session.mode}
            onPropsChange={workshop.patchProps}
            session={workshop.session}
            specimen={workshop.specimen}
            theme={workshop.theme}
          />
        </div>
        <footer className="stage-status"><span className="status-dot" />{workshop.status}<span>·</span><span>Stable URL updated</span></footer>
      </main>

      <aside className="inspector-panel">
        <section className="profile-bar">
          <div className="panel-heading"><span>Design profile</span>{unsavedCount ? <em>{unsavedCount} unsaved</em> : baselineDrift ? <em className="warning-text">baseline drift</em> : <em>saved</em>}</div>
          <select onChange={(event) => workshop.selectProfile(event.target.value)} value={workshop.activeProfile.id}>
            {workshop.profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}{profile.readonly ? ' · reference' : ''}</option>)}
          </select>
          <div className="profile-actions">
            <button className="button button--quiet" disabled={workshop.activeProfile.readonly || !unsavedCount} onClick={() => void workshop.save()}>Save</button>
            <button className="button" onClick={() => void saveAs()}>Save as…</button>
          </div>
        </section>

        <section className="props-section">
          <div className="panel-heading"><span>Specimen props</span></div>
          <div className="inspector-section">
            {Object.entries(workshop.specimen.controls).map(([key, control]) => {
              const value = workshop.session.props[key] ?? workshop.specimen.defaultProps[key] ?? ''
              if (control.type === 'boolean') {
                return <label className="toggle toggle--wide" key={key}><input checked={Boolean(value)} onChange={(event) => workshop.patchProps({ [key]: event.target.checked })} type="checkbox" /><span /> {control.label}</label>
              }
              return (
                <label className="control-field" key={key}>
                  <span>{control.label}</span>
                  {control.type === 'select' ? (
                    <select onChange={(event) => workshop.patchProps({ [key]: event.target.value })} value={String(value)}>{control.options.map((option) => <option key={option}>{option}</option>)}</select>
                  ) : (
                    <input onChange={(event) => workshop.patchProps({ [key]: event.target.value })} type="text" value={String(value)} />
                  )}
                </label>
              )
            })}
          </div>
        </section>

        <section className="theme-section">
          <div className="panel-heading"><span>Theme system</span><em>OKLCH</em></div>
          <ThemeEditor mode={workshop.session.mode} onEdit={workshop.editTheme} theme={workshop.theme} />
        </section>
      </aside>
      </>}
    </div>
  )
}
