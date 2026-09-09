import { useId, useState, type CSSProperties } from 'react'
import { Button, Panel } from '../components'
import type { ComponentSpecimen } from '../themes'
import { targets } from './target-framing/fixtures'
import './Panel.target-comparison.specimen.css'

type Props = Record<string, string | number | boolean>
const subjects = [
  { ...targets[0]!, start: 0, end: 75, advice: 'Broadband' },
  { ...targets[1]!, start: 0, end: 250, advice: 'L-Ultimate' },
  { ...targets[2]!, start: 90, end: 360, advice: 'Broadband' },
]
const time = (minute: number) => `${String((22 + Math.floor(minute / 60)) % 24).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
const duration = (minutes: number) => `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}h ` : ''}${minutes % 60 ? `${minutes % 60}m` : minutes === 0 ? '0m' : ''}`.trim()

function Comparison({ props, onPropsChange }: { props: Props; onPropsChange?: (patch: Props) => void }) {
  const [local, setLocal] = useState(props)
  const values = onPropsChange ? props : local
  const update = (patch: Props) => onPropsChange ? onPropsChange(patch) : setLocal(current => ({ ...current, ...patch }))
  const rawMinute = Number(values.minute)
  const cursor = Number.isFinite(rawMinute) ? Math.max(0, Math.min(360, Math.round(rawMinute / 5) * 5)) : 0
  const shown = subjects.filter(subject => values[subject.id] !== false)
  const selected = shown.find(subject => subject.id === values.selected)
  const selectedTradeoff = selected ? cursor >= selected.end
    ? `Its useful window ended at ${time(selected.end)}.`
    : cursor < selected.start
      ? `Wait ${duration(selected.start - cursor)} to reach 30°, then ${duration(selected.end - selected.start)} of useful sky remains.`
      : `${duration(selected.end - cursor)} of useful sky remains at ${time(cursor)}. ${selected.end < 360 ? `The window closes at ${time(selected.end)}.` : 'It stays useful until sample dawn.'}`
    : 'Move one time control to compare the same moment for every subject.'
  const id = useId()
  return <section className="vela-target-compare" aria-label="Compare target opportunities" style={{ '--compare-cursor': `${cursor / 3.6}%` } as CSSProperties}>
    <header className="vela-target-compare__heading"><p>Workshop experiment · sample night</p><h1>Which subject gets your night?</h1><span>Compare useful sky from 22:00 until dawn. These windows are invented, not an observing forecast.</span></header>
    <div className="vela-target-compare__choices" aria-label="Subjects to compare">{subjects.map(subject => <Button key={subject.id} size="small" tone="quiet" aria-pressed={values[subject.id] !== false} disabled={shown.length === 2 && values[subject.id] !== false} onClick={() => update({ [subject.id]: values[subject.id] === false, ...(values.selected === subject.id ? { selected: '' } : {}) })}>{values[subject.id] === false ? '+ ' : '✓ '}{subject.catalog}</Button>)}<span>Compare two or three</span></div>
    <div className="vela-target-compare__time">
      <div><label htmlFor={id}>Look ahead <strong>{time(cursor)}</strong></label><Button size="small" tone="quiet" disabled={cursor === 0} onClick={() => update({ minute: 0 })}>Back to now</Button></div>
      <input id={id} type="range" min={0} max={360} step={5} value={cursor} aria-valuetext={`${time(cursor)}, ${duration(cursor)} after sample now`} onChange={event => update({ minute: Number(event.target.value) })} />
      <div className="vela-target-compare__ticks" aria-hidden="true">{['Now · 22:00', '00:00', '02:00', 'Dawn · 04:00'].map(tick => <span key={tick}>{tick}</span>)}</div>
    </div>
    <div className="vela-target-compare__rows">{shown.map(subject => {
      const active = cursor >= subject.start && cursor < subject.end
      const remaining = Math.max(0, subject.end - Math.max(cursor, subject.start))
      const status = cursor >= subject.end ? 'Useful window ended' : cursor < subject.start ? `Above 30° in ${duration(subject.start - cursor)}` : `${duration(remaining)} useful sky left`
      return <article className="vela-target-compare__row" key={subject.id} data-selected={selected?.id === subject.id}>
        <button className="vela-target-compare__identity" aria-pressed={selected?.id === subject.id} onClick={() => update({ selected: subject.id })}><img src={subject.image} alt="" /><span><small>{subject.catalog}</small><strong>{subject.name}</strong><small>{subject.advice}</small></span></button>
        <div className="vela-target-compare__opportunity"><div className="vela-target-compare__band" aria-label={`${subject.name}: above 30 degrees from ${time(subject.start)} to ${time(subject.end)}`}><span className="vela-target-compare__window" style={{ left: `${subject.start / 3.6}%`, width: `${(subject.end - subject.start) / 3.6}%` }} /><span className="vela-target-compare__cursor" aria-hidden="true" /></div><div className="vela-target-compare__status" data-active={active}><strong>{status}</strong><span>{time(subject.start)}–{time(subject.end)}</span></div></div>
      </article>
    })}</div>
    <p className="vela-target-compare__legend"><span />Useful above 30° · the line marks your selected time</p>
    <Panel className="vela-target-compare__decision" title={selected ? selected.name : 'Choose a photograph to inspect the tradeoff'} description={selectedTradeoff}>
      {selected ? <><p>{selected.advice === 'L-Ultimate' ? 'Its emission lines suit L-Ultimate. Choose this if you want to keep the dual-band filter fitted.' : 'Broadband suits this subject’s starlight. Consider the filter change if L-Ultimate is fitted.'}</p><small>This choice stays in the experiment. It does not start a capture or save a plan.</small></> : <p>M13 is ready now but sets soon. Andromeda asks you to wait. Crescent offers the middle ground.</p>}
    </Panel>
    <details className="vela-target-compare__credits"><summary>Reference photograph credits</summary>{subjects.map(subject => <p key={subject.id}><a href={subject.source} target="_blank" rel="noreferrer">{subject.name}</a> · {subject.credit} · CC BY 4.0</p>)}</details>
  </section>
}

export const specimen: ComponentSpecimen = {
  componentId: 'panel', componentName: 'Panel / Card', id: 'panel-target-comparison', name: 'Compare the remaining night · Experiment',
  description: 'Two or three photographic candidates on aligned useful-sky bands. Shared time scrubbing makes waiting versus setting tangible. Invented sample night only.',
  controls: {
    minute: { type: 'text', label: 'Minutes after 22:00' },
    selected: { type: 'select', label: 'Selected subject', options: ['', ...subjects.map(subject => subject.id)] },
  },
  defaultProps: { minute: 0, selected: 'm13', ...Object.fromEntries(subjects.map(subject => [subject.id, true])) },
  render: (props, onPropsChange) => <Comparison props={props} {...(onPropsChange ? { onPropsChange } : {})} />,
}
