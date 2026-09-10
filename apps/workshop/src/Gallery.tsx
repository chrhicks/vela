import { useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { themeStyle } from '@vela/ui/themes'
import type { ThemeParameters, WorkingSession } from '@vela/ui/themes'
import { CompositionPreview, compositions } from './Compositions'
import { contrastFindings, sourceFindings } from './diagnostics'
import { componentGroups } from './registry'

interface GalleryProps {
  theme: ThemeParameters
  profileName: string
  density: number
  baselineDrift: boolean
  onOpenSpecimen: (componentId: string, specimenId: string) => void
  onOpenComposition: (componentId: string, specimenId: string, context: WorkingSession['context']) => void
}

export function Gallery({ theme, profileName, density, baselineDrift, onOpenSpecimen, onOpenComposition }: GalleryProps) {
  const [query, setQuery] = useState('')
  const normalized = query.trim().toLowerCase()

  const groups = componentGroups.filter((group) => {
    const specimen = group.specimens[0]

    return !normalized || `${group.name} ${specimen?.description ?? ''}`.toLowerCase().includes(normalized)
  })

  const findings = useMemo(() => contrastFindings(theme), [theme])
  const contrastWarnings = findings.filter((finding) => !finding.passes)

  return (
    <main className="gallery">
      <header className="gallery-hero">
        <div><div className="eyebrow">Cohesion gallery · {profileName}</div><h1>Initial primitive library</h1><p>Paired light and dark previews use the active profile at {Math.round(density * 100)}% density.</p></div>
        <label className="gallery-search"><span>Search components</span><input onChange={(event) => setQuery(event.target.value)} placeholder="Button, status, selection…" type="search" value={query} /></label>
      </header>

      <section className="diagnostic-strip">
        <div><span className={`diagnostic-state ${contrastWarnings.length ? 'warning' : 'clear'}`} /> <strong>Contrast</strong><small>{contrastWarnings.length ? `${contrastWarnings.length} focused warning${contrastWarnings.length === 1 ? '' : 's'}` : `${findings.length} focused pairs clear`}</small></div>
        <div><span className={`diagnostic-state ${sourceFindings.length ? 'warning' : 'clear'}`} /> <strong>Token use</strong><small>{sourceFindings.length ? `${sourceFindings.length} literal color finding${sourceFindings.length === 1 ? '' : 's'}` : 'No literal colors in component source'}</small></div>
        <div><span className={`diagnostic-state ${baselineDrift ? 'warning' : 'clear'}`} /> <strong>Baseline</strong><small>{baselineDrift ? 'Profile fingerprint differs' : 'Profile matches current default'}</small></div>
        <details><summary>Review diagnostics</summary><div className="diagnostic-popover"><h3>Focused contrast</h3>{findings.map((finding) => <div className="diagnostic-row" key={finding.id}><span>{finding.mode} · {finding.label}</span><strong data-pass={finding.passes}>{finding.ratio.toFixed(2)}:1</strong></div>)}<h3>Literal colors</h3>{sourceFindings.length ? sourceFindings.map((finding) => <div className="diagnostic-row" key={`${finding.file}-${finding.value}`}><span>{finding.file}</span><code>{finding.value}</code></div>) : <p>No hexadecimal or functional color literals found in component source or package styles.</p>}</div></details>
      </section>

      <section className="gallery-section">
        <div className="gallery-section__heading"><div><h2>Components</h2><p>One primary specimen per component. Open a card for props, contexts, profiles, and responsive evaluation.</p></div><em>{groups.length} of {componentGroups.length}</em></div>
        <div className="gallery-grid">
          {groups.map((group) => {
            const specimen = group.specimens[0]

            if (!specimen) return null

            return (
              <article className="gallery-card" key={group.id}>
                <div className="gallery-card__heading"><div><span>{group.name.slice(0, 1)}</span><div><strong>{group.name} <b className="stability-label" data-stability={group.stability}>{group.stability}</b></strong><small>{specimen.name}</small></div></div><button onClick={() => onOpenSpecimen(group.id, specimen.id)}>{group.specimens.length} specimen{group.specimens.length === 1 ? '' : 's'} · Open ↗</button></div>
                <div className="paired-preview">
                  {(['light', 'dark'] as const).map((mode) => <div className="vela-theme gallery-surface" data-mode={mode} key={mode} style={themeStyle(theme, mode) as CSSProperties}><small>{mode}</small><div>{specimen.render(specimen.defaultProps)}</div></div>)}
                </div>
                <p>{specimen.description}</p>
              </article>
            )
          })}
        </div>
        {!groups.length ? <div className="gallery-empty">No components match “{query}”.</div> : null}
      </section>

      <section className="gallery-section gallery-section--compositions">
        <div className="gallery-section__heading"><div><h2>Compositions</h2><p>Fixed arrangements built from the real primitives—not a freeform canvas.</p></div><em>{compositions.length}</em></div>
        <div className="composition-grid">
          {compositions.map((composition) => <article className="composition-card" key={composition.id}><div className="composition-card__heading"><div><strong>{composition.name}</strong><p>{composition.description}</p></div><button onClick={() => onOpenComposition(composition.componentId, composition.specimenId, composition.context)}>Open context ↗</button></div><div className="composition-pair"><CompositionPreview composition={composition} mode="light" theme={theme} /><CompositionPreview composition={composition} mode="dark" theme={theme} /></div></article>)}
        </div>
      </section>
    </main>
  )
}
