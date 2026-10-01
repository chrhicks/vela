import { useState } from 'react'
import { Button, Input, NavigationBar, Select, Tabs } from '../components'
import type { ComponentSpecimen } from '../themes'
import './Panel.photograph-library.specimen.css'

const targets = [
  { id: 'crescent', name: 'Crescent Nebula', catalog: 'NGC 6888', image: new URL('./target-framing/crescent.jpg', import.meta.url).href },
  { id: 'andromeda', name: 'Andromeda Galaxy', catalog: 'M31', image: new URL('./target-framing/andromeda.jpg', import.meta.url).href },
  { id: 'm13', name: 'Hercules Cluster', catalog: 'M13', image: new URL('./target-framing/m13.jpg', import.meta.url).href },
  { id: 'unassigned', name: 'No recorded target', catalog: '', image: '' },
]

const nights = ['30 Sep 2026', '28 Sep 2026', '21 Sep 2026', '18 Sep 2026']

const batches = [
  { night: 0, target: 0, count: 18 }, { night: 0, target: 1, count: 8 },
  { night: 1, target: 1, count: 12 }, { night: 1, target: 3, count: 3 },
  { night: 2, target: 0, count: 9 }, { night: 2, target: 2, count: 6 },
  { night: 3, target: 2, count: 8 },
]

const photographs = batches.flatMap((batch, batchIndex) => Array.from({ length: batch.count }, (_, index) => ({
  id: `${batchIndex}-${index}`,
  night: batch.night,
  target: targets[batch.target]!,
  time: batchIndex === 0 && index < 3 ? `00:${String(12 - index * 3).padStart(2, '0')}:08` : `${batchIndex === 1 || batchIndex === 3 || batchIndex === 5 ? '21' : '22'}:${String(57 - index * 3).padStart(2, '0')}:08`,
  afterMidnight: batchIndex === 0 && index < 3,
})))

type Props = Record<string, string | number | boolean>

function PhotographLibrary({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  const [local, setLocal] = useState(props)
  const [query, setQuery] = useState('')
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const byNight = values.browse !== 'targets'
  const group = String(values.group ?? '')
  const filter = String(values.filter ?? '')
  const selected = photographs.find(photo => photo.id === values.selected)
  const inGroup = photographs.filter(photo => byNight ? String(photo.night) === group : photo.target.id === group)
  const visible = inGroup.filter(photo => !filter || (byNight ? photo.target.id === filter : String(photo.night) === filter))
  const selectedIndex = visible.findIndex(photo => photo.id === selected?.id)
  const title = byNight ? `Night of ${nights[Number(group)]}` : targets.find(target => target.id === group)?.name

  const groups = byNight
    ? nights.map((night, index) => ({ id: String(index), title: night, photos: photographs.filter(photo => photo.night === index) }))
    : targets.map(target => ({ id: target.id, title: target.name, photos: photographs.filter(photo => photo.target.id === target.id) }))

  const shownGroups = groups.filter(item => `${item.title} ${item.photos.map(photo => `${photo.target.name} ${photo.target.catalog} ${nights[photo.night]}`).join(' ')}`.toLowerCase().includes(query.toLowerCase()))
  const openGroup = (id: string) => update({ group: id, selected: '', filter: '' })
  const openPhoto = (id: string) => update({ selected: id })

  const groupCards = <>
    <div className="vela-library-demo__search">
      <Input label={byNight ? 'Find a night or target' : 'Find a target'} type="search" placeholder={byNight ? 'September, Crescent…' : 'M31, Crescent…'} value={query} onChange={event => setQuery(event.target.value)} />
      <span role="status">{shownGroups.length} {byNight ? 'nights' : 'targets'} · {shownGroups.reduce((sum, item) => sum + item.photos.length, 0)} photographs</span>
    </div>
    <div className="vela-library-demo__groups">
      {shownGroups.map(item => {
        const cover = item.photos.find(photo => photo.target.image)?.target
        const names = [...new Set(item.photos.map(photo => byNight ? photo.target.name : nights[photo.night]))]

        return <button type="button" className="vela-library-demo__group" key={item.id} onClick={() => openGroup(item.id)}>
          <div className="vela-library-demo__cover">{cover ? <img src={cover.image} alt="" /> : <span>No target recorded</span>}</div>
          <div><h2>{item.title}</h2><p>{item.photos.length} photographs · {byNight ? `${names.length} target${names.length === 1 ? '' : 's'}` : `${names.length} night${names.length === 1 ? '' : 's'}`}</p><p>{names.join(' · ')}</p></div>
          <span aria-hidden="true">→</span>
        </button>
      })}
    </div>
    {shownGroups.length === 0 && <p className="vela-library-demo__empty">No matching {byNight ? 'nights' : 'targets'}. Try a different search.</p>}
    {byNight && <p className="vela-library-demo__hint">Each night includes the following morning, through noon. Times shown in observatory local time.</p>}
  </>

  return <article className="vela-library-demo" aria-label="Photograph library workshop proposal">
    <NavigationBar home={{ href: '#', onClick: event => event.preventDefault() }} rigs={[{ id: 'askar', name: 'Askar FRA 400' }]} currentRigId="askar" onRigChange={() => {}} utility={<span>● Connected</span>} links={['Tonight', 'Explore the sky', 'Photographs'].map((label, index) => ({ href: '#', label, current: index === 2, onClick: event => event.preventDefault() }))} />
    <header className="vela-library-demo__heading"><h1>Photographs</h1><span>Askar FRA 400 · 64 photographs</span><p>Available even when the rig is disconnected</p></header>
    <main>
      {!group ? <Tabs value={byNight ? 'nights' : 'targets'} onValueChange={browse => { update({ browse, group: '', selected: '', filter: '' }); setQuery('') }} items={[
        { id: 'nights', label: 'Nights', content: groupCards },
        { id: 'targets', label: 'Targets', content: groupCards },
      ]} /> : <>
        <div className="vela-library-demo__back"><Button onClick={() => selected ? update({ selected: '' }) : update({ group: '', filter: '' })}>← {selected ? title : `All ${byNight ? 'nights' : 'targets'}`}</Button></div>
        <div className="vela-library-demo__group-heading"><div><h2>{title}</h2><p>{visible.length} photographs{filter ? ' matching filter' : ''} · Newest first</p></div>
          {!selected && <Select label={byNight ? 'Target' : 'Observing night'} value={filter} onChange={event => update({ filter: event.target.value })} options={[
            { value: '', label: byNight ? 'All targets' : 'All nights' },
            ...(byNight ? targets.flatMap(target => inGroup.some(photo => photo.target.id === target.id) ? [{ value: target.id, label: target.name }] : []) : nights.flatMap((night, index) => inGroup.some(photo => photo.night === index) ? [{ value: String(index), label: night }] : [])),
          ]} />}
        </div>
        {selected ? <div className="vela-library-demo__inspection">
          <section className="vela-library-demo__viewer" aria-label="Selected photograph">
            <header><span>{selected.afterMidnight ? '1 Oct' : nights[selected.night]} · {selected.time}</span><span>Fit</span></header>
            <div>{selected.target.image ? <img src={selected.target.image} alt={`${selected.target.name} reference photograph`} /> : <p>No preview in this sample</p>}</div>
            <footer><Button disabled={selectedIndex <= 0} onClick={() => openPhoto(visible[selectedIndex - 1]!.id)}>← Newer</Button><span>{selectedIndex + 1} of {visible.length}</span><Button disabled={selectedIndex >= visible.length - 1} onClick={() => openPhoto(visible[selectedIndex + 1]!.id)}>Older →</Button></footer>
          </section>
          <aside><h2>{selected.target.name}</h2><p>{selected.target.catalog}</p><dl><div><dt>Observing night</dt><dd>{nights[selected.night]}</dd></div><div><dt>Captured</dt><dd>{selected.afterMidnight ? '1 Oct 2026' : nights[selected.night]} · {selected.time}</dd></div><div><dt>Camera</dt><dd>ZWO ASI2600MC Pro</dd></div><div><dt>Exposure</dt><dd>180 seconds · Color</dd></div></dl><p className="vela-library-demo__hint">Sample metadata and reference image. Image inspection and downloads retain their existing application behavior.</p></aside>
        </div> : <div className="vela-library-demo__photos">
          {visible.map(photo => <button type="button" key={photo.id} onClick={() => openPhoto(photo.id)} aria-label={`Open ${photo.target.name}, ${nights[photo.night]}, ${photo.time}`}>
            <div>{photo.target.image ? <img src={photo.target.image} alt="" loading="lazy" /> : <span>No sample preview</span>}</div>
            <strong>{photo.target.name}</strong><span>{byNight ? '' : `${nights[photo.night]} · `}{photo.time}{photo.afterMidnight ? ' · following morning' : ''}</span><small>180 s · Color</small>
          </button>)}
        </div>}
      </>}
    </main>
    <footer className="vela-library-demo__footer">Workshop proposal · Sample nights and targets · Reference photographs repeat to illustrate browsing</footer>
  </article>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'photograph-library',
  name: 'Photographs by night or target · Product proposal',
  description: 'Browse sample nights or targets equally, narrow a group, then inspect a photograph. A local workshop exploration, not archive or session management. No network requests or device commands.',
  controls: { browse: { type: 'select', label: 'Browse by', options: ['nights', 'targets'] } },
  defaultProps: { browse: 'nights', group: '', selected: '', filter: '' },
  render: (props, onPropsChange) => <PhotographLibrary props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
