import { useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { Button } from '../components/Button'
import { Select } from '../components/Select'
import type { ComponentSpecimen } from '../themes'
import './Panel.preview-color.specimen.css'

const fixtureSchema = z.object({
  key: z.enum(['starfield', 'prefocus', 'warm', 'cooled', 'dark', 'trails']),
  id: z.string(),
  label: z.string(),
  note: z.string(),
  source: z.string(),
  sha256: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  range: z.object({ black: z.number(), ceiling: z.number() }),
  estimate: z.object({
    offsets: z.array(z.number()).length(3),
    status: z.string(),
    background: z.array(z.number()).length(3),
  }),
})

const manifestSchema = z.object({
  renderer: z.string(),
  baseline: z.string(),
  fixtures: z.array(fixtureSchema),
})

type Fixture = z.infer<typeof fixtureSchema>

type Corpus = z.infer<typeof manifestSchema>

type Props = Record<string, string | number | boolean>

function PreviewPair({ fixture, scale }: { fixture: Fixture; scale: string }) {
  const windows = useRef<(HTMLDivElement | null)[]>([])
  const [loaded, setLoaded] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const native = scale === 'native'

  function center() {
    for (const element of windows.current) {
      if (!element) continue
      element.scrollLeft = (fixture.width - element.clientWidth) / 2
      element.scrollTop = (fixture.height - element.clientHeight) / 2
    }
  }

  return (
    <>
      {native && (
        <div className="vela-preview-color__native-tools">
          <span>1 image pixel = 1 CSS pixel · scroll either view to pan both</span>
          <Button size="small" onClick={center}>
            Center image
          </Button>
        </div>
      )}
      {failed && (
        <p role="alert">A local derivative could not load. Regenerate the fixture corpus.</p>
      )}
      {!failed && loaded.length < 2 && <p role="status">Loading the {scale} comparison…</p>}
      <div className="vela-preview-color__pair" data-scale={scale}>
        {['current', 'neutral'].map((treatment, index) => (
          <figure key={treatment}>
            <figcaption>
              <strong>
                {treatment === 'current' ? 'A · Current preview' : 'B · Bounded background'}
              </strong>
              <span>
                {treatment === 'current'
                  ? 'Shared black point + linked asinh'
                  : 'Subtract background offsets + same linked asinh'}
              </span>
            </figcaption>
            <div
              className="vela-preview-color__window"
              ref={element => {
                windows.current[index] = element
              }}
              tabIndex={native ? 0 : undefined}
              role={native ? 'region' : undefined}
              aria-label={
                native ? `${treatment} preview at native scale; scroll to inspect` : undefined
              }
              onScroll={event => {
                if (!native) return
                const other = windows.current[1 - index]

                if (!other) return
                other.scrollLeft = event.currentTarget.scrollLeft
                other.scrollTop = event.currentTarget.scrollTop
              }}
            >
              <img
                src={`/__preview-color/${fixture.key}-${treatment}-${native ? 'native' : 'fit'}.png`}
                alt={`${fixture.label}, ${treatment === 'current' ? 'current rendering' : 'bounded background rendering'}`}
                style={{ visibility: loaded.length === 2 && !failed ? 'visible' : 'hidden' }}
                onLoad={() => {
                  setLoaded(previous =>
                    previous.includes(treatment) ? previous : [...previous, treatment],
                  )

                  if (native) center()
                }}
                onError={() => setFailed(true)}
              />
            </div>
          </figure>
        ))}
      </div>
    </>
  )
}

function PreviewColor({
  props,
  onPropsChange,
}: {
  props: Props
  onPropsChange?: ((patch: Props) => void) | undefined
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const [corpus, setCorpus] = useState<Corpus | null>(null)
  const [error, setError] = useState('')

  const update = (patch: Props) =>
    onPropsChange ? onPropsChange(patch) : setLocal(previous => ({ ...previous, ...patch }))

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      try {
        const response = await fetch('/__preview-color/manifest.json', {
          signal: controller.signal,
        })

        if (!response.ok)
          throw new Error(
            'Generate the local corpus to view the comparison. See apps/workshop/preview-color/README.md.',
          )
        setCorpus(manifestSchema.parse(await response.json()))
      } catch (failure) {
        if (!controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : 'Local corpus unavailable')
      }
    }

    void load()

    return () => controller.abort()
  }, [])

  if (error) return <p role="alert">{error}</p>

  if (!corpus) return <p role="status">Loading local retained-image fixtures…</p>
  const fixture = corpus.fixtures.find(item => item.key === values.fixture)

  if (!fixture) return <p role="alert">This fixture is not in the generated local corpus.</p>
  const scale = String(values.scale)

  return (
    <article className="vela-preview-color">
      <header>
        <p>Retained exposures · Workshop only</p>
        <h1>Preview color</h1>
        <p>
          Judge the sky background, star profiles and faint structure. Both views are display aids,
          not calibrated color.
        </p>
      </header>
      <div className="vela-preview-color__controls">
        <Select
          label="Real exposure"
          options={corpus.fixtures.map(item => ({ value: item.key, label: item.label }))}
          value={fixture.key}
          onChange={event => update({ fixture: event.target.value })}
        />
        <div className="vela-preview-color__scale" aria-label="Preview scale">
          {Object.entries({ fit: 'Fit', native: '100%', thumbnail: 'Thumbnail' }).map(
            ([value, label]) => (
              <Button
                key={value}
                size="small"
                aria-pressed={scale === value}
                tone={scale === value ? 'neutral' : 'quiet'}
                onClick={() => update({ scale: value })}
              >
                {label}
              </Button>
            ),
          )}
        </div>
      </div>
      <p className="vela-preview-color__note">{fixture.note}</p>
      <PreviewPair key={`${fixture.key}-${scale}`} fixture={fixture} scale={scale} />
      <p className="vela-preview-color__estimate">
        {fixture.estimate.status} · subtract R {fixture.estimate.offsets[0]?.toFixed(1)}, G{' '}
        {fixture.estimate.offsets[1]?.toFixed(1)}, B {fixture.estimate.offsets[2]?.toFixed(1)} ADU
      </p>
      <details>
        <summary>Source identity and treatment</summary>
        <dl>
          <dt>Retained source</dt>
          <dd>{fixture.id}</dd>
          <dt>Local read-only input</dt>
          <dd>{fixture.source}</dd>
          <dt>Original SHA-256</dt>
          <dd>{fixture.sha256}</dd>
          <dt>Dimensions</dt>
          <dd>
            {fixture.width} × {fixture.height}; top-down sensor orientation
          </dd>
          <dt>Renderer</dt>
          <dd>
            {corpus.renderer} · baseline {corpus.baseline}
          </dd>
          <dt>Linked range</dt>
          <dd>
            {fixture.range.black}–{fixture.range.ceiling} ADU · asinh strength 10 in both views
          </dd>
        </dl>
        <p>
          B estimates channel backgrounds from the same dimmest quarter of 8 × 8 spatial tiles. It
          subtracts only excess over the lowest channel, capped at 10% of the shared display range.
          There are no per-channel gains, white balancing or per-channel stretches. Emission
          covering the whole frame can still bias the estimate.
        </p>
        <p>
          Native and fit use the same displayed pixels. Thumbnail scales down the fitted derivative.
          Original FITS, retained PNGs, raw statistics and solving inputs are untouched.
        </p>
      </details>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel',
  componentName: 'Panel / Card',
  id: 'panel-preview-color',
  name: 'Preview color · Retained-image comparison',
  description:
    'Current preview versus bounded display-only background subtraction on local real exposures. No production adoption or device commands.',
  controls: {
    fixture: {
      type: 'select',
      label: 'Retained fixture',
      options: ['starfield', 'prefocus', 'warm', 'cooled', 'dark', 'trails'],
    },
    scale: { type: 'select', label: 'Image scale', options: ['fit', 'native', 'thumbnail'] },
  },
  defaultProps: { fixture: 'cooled', scale: 'fit' },
  render: (props, onPropsChange) => <PreviewColor props={props} onPropsChange={onPropsChange} />,
}
