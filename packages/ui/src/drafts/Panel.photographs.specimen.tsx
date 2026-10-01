import { useRef, useState } from 'react'
import { Button, NavigationBar } from '../components'
import type { ComponentSpecimen } from '../themes'
import './Panel.photographs.specimen.css'

const crescent = new URL('./target-framing/crescent.jpg', import.meta.url).href

type Props = Record<string, string | number | boolean>

const times = ['21:39:08', '21:36:02', '21:32:56', '21:29:50', '21:26:44', '21:23:38', '21:20:32', '21:17:26', '21:14:20', '21:11:14', '21:08:08', '21:05:02']

function Photographs({ props, onPropsChange }: {
  props: Props
  onPropsChange?: (patch: Props) => void
}) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local

  const update = (patch: Props) => onPropsChange
    ? onPropsChange(patch)
    : setLocal(current => ({ ...current, ...patch }))

  const selected = Math.max(0, Math.min(11, Number(values.selected) || 0))
  const revealed = Math.max(selected + 1, Number(values.revealed) || 6)
  const unavailable = values.preview === 'unavailable'
  const list = useRef<HTMLHeadingElement>(null)
  const viewer = useRef<HTMLElement>(null)
  const [notice, setNotice] = useState('')
  const demonstrate = (action: string) => setNotice(`Workshop example: ${action}. No file is downloaded.`)

  return (
    <article className="vela-photographs-demo" aria-label="Photographs product example">
      <NavigationBar
        home={{ href: '#', onClick: event => event.preventDefault() }}
        rigs={[{ id: 'askar', name: 'Askar FRA 400' }]}
        currentRigId="askar"
        onRigChange={() => {}}
        utility={<span>● Connected</span>}
        links={['Tonight', 'Explore the sky', 'Photographs'].map((label, index) => ({
          href: `#page-${index}`, label, current: index === 2,
          onClick: event => event.preventDefault(),
        }))}
      />
      <header className="vela-photographs-demo__heading">
        <h1>Photographs</h1>
        <span>Askar FRA 400 · 12 saved images</span>
        <p>Available even when the rig is disconnected</p>
      </header>
      <div className="vela-photographs-demo__jump">
        <span>Selected · {times[selected]}</span>
        <Button onClick={() => { list.current?.focus(); list.current?.scrollIntoView({ block: 'start' }) }}>Jump to photographs ↓</Button>
      </div>
      <main className="vela-photographs-demo__layout">
        <section className="vela-photographs-demo__list" aria-label="Saved photographs">
          <header><h2 ref={list} tabIndex={-1}>30 September 2026</h2><span>Newest first</span></header>
          <div className="vela-photographs-demo__rows">
            {times.slice(0, revealed).map((time, index) => (
              <a
                key={time}
                href={`#photograph-${index}`}
                aria-current={index === selected ? 'true' : undefined}
                aria-label={`${time}${index === selected ? ' · Current selection' : ''}`}
                onClick={event => {
                  event.preventDefault()
                  update({ selected: index })
                  viewer.current?.focus()
                  viewer.current?.scrollIntoView({ block: 'nearest' })
                }}
              >
                <img src={crescent} alt="" loading="lazy" />
                <span><strong>{time}</strong><small>180 s · Color</small></span>
                <span aria-hidden="true">{index === selected ? '→' : ''}</span>
              </a>
            ))}
          </div>
          {revealed < times.length && <Button onClick={() => {
            update({ revealed: Math.min(12, revealed + 6) })
            list.current?.focus()
          }}>Show {Math.min(6, times.length - revealed)} earlier images</Button>}
        </section>
        <section className="vela-photographs-demo__viewer" aria-label="Selected photograph" tabIndex={-1} ref={viewer}>
          <header>
            <span>30 Sep · {times[selected]}</span>
            <div>
              <Button aria-pressed className="vela-photographs-demo__fit" onClick={() => setNotice('Fitted reference image.')}>Fit</Button>
              <Button onClick={() => setNotice('Workshop composition only. Native inspection is exercised in the application.')}>100%</Button>
              <Button className="vela-photographs-demo__enlarge" aria-label="Enlarge photograph" onClick={() => setNotice('Workshop composition only. Enlargement is exercised in the application.')}>↗</Button>
            </div>
          </header>
          <div className="vela-photographs-demo__pixels"><img src={crescent} alt="Crescent Nebula reference photograph" /></div>
          <footer><span>{unavailable ? 'Reference image · Original preview' : 'Reference image · Mock saved exposure'}</span><span>Image {12 - selected} of 12</span></footer>
        </section>
        <section className="vela-photographs-demo__details" aria-label="Exposure details">
          <header><h2>Exposure details</h2><p>Saved on this Vela server</p></header>
          <dl>
            <div><dt>Captured</dt><dd>30 Sep 2026 · {times[selected]}</dd></div>
            <div><dt>Camera</dt><dd>ZWO ASI2600MC Pro</dd></div>
            <div><dt>Exposure</dt><dd>180 seconds · Color</dd></div>
            <div><dt>Dimensions</dt><dd>1280 × 1224 px</dd></div>
            <div><dt>Stars · HFR</dt><dd>842 stars · 2.10 px</dd></div>
          </dl>
          <div className="vela-photographs-demo__downloads">
            {unavailable ? <aside className="vela-photographs-demo__fallback">
              <p className="vela-photographs-demo__context">Saved photograph · Preview fallback</p>
              <h3>Showing the original preview</h3>
              <p>The updated preview could not be generated. The original FITS file is unchanged and still available to download.</p>
              <Button onClick={() => demonstrate('original FITS download')}>Download original FITS ↓</Button>
            </aside> : <Button tone="accent" onClick={() => demonstrate('original FITS download')}>Download original FITS ↓</Button>}
            <Button onClick={() => demonstrate(unavailable ? 'original PNG download' : 'display PNG download')}>Download {unavailable ? 'original' : 'display'} PNG ↓</Button>
            {!unavailable && <p>The FITS file retains the original capture data.</p>}
          </div>
        </section>
      </main>
      {notice && <p role="status" className="vela-photographs-demo__notice">{notice}</p>}
      <footer className="vela-photographs-demo__footer"><span>Saved images belong to this rig. Select another rig to browse its photographs.</span><span>Design study · Sample image metadata</span></footer>
    </article>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'fieldroom-photographs',
  name: 'Photographs · Fieldroom product example',
  description: 'Source 03.4 composition, compact selection flow and 03.14 preserved-preview fallback. Local Crescent reference; inspection controls explain their existing application behavior. No network reads or downloads.',
  controls: {
    preview: { type: 'select', label: 'Preview treatment', options: ['current', 'unavailable'] },
    selected: { type: 'select', label: 'Selected photograph (newest = 0)', options: times.map((_, index) => String(index)) },
    revealed: { type: 'select', label: 'Revealed photographs', options: ['6', '12'] },
  },
  defaultProps: { preview: 'current', selected: 0, revealed: 6 },
  render: (props, onPropsChange) => <Photographs props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
