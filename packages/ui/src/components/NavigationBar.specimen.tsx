import { NavigationBar } from './NavigationBar'
import type { ComponentSpecimen } from '../themes'

export const specimen: ComponentSpecimen = {
  componentId: 'navigation-bar',
  componentName: 'Navigation bar',
  id: 'navigation-bar-anatomy',
  name: 'Primitive anatomy',
  description: 'Rig context, page links and optional capture activity. Callers own destinations, current state and progress.',
  controls: {
    rig: { type: 'select', label: 'Viewing rig', options: ['askar', 'seestar', 'all'] },
    page: { type: 'select', label: 'Current page', options: ['observe', 'targets', 'capture'] },
    activity: { type: 'select', label: 'Activity', options: ['exposing', 'reading', 'interrupted', 'none'] },
  },
  defaultProps: { rig: 'askar', page: 'targets', activity: 'exposing' },
  render: (props, onPropsChange) => <NavigationBar
    home={{ href: '#rigs', onClick: event => { event.preventDefault(); onPropsChange?.({ rig: 'all' }) } }}
    rigs={[{ id: 'all', name: 'All rigs' }, { id: 'askar', name: 'Askar FRA 400' }, { id: 'seestar', name: 'Seestar S30' }]}
    currentRigId={String(props.rig)}
    onRigChange={rig => onPropsChange?.({ rig })}
    links={props.rig === 'all' ? [] : ['observe', 'targets', 'capture'].map(page => ({ href: `#${page}`, label: page[0]!.toUpperCase() + page.slice(1), current: props.page === page, onClick: event => { event.preventDefault(); onPropsChange?.({ page }) } }))}
    {...(props.activity === 'none' ? {} : { activity: {
      href: '#capture',
      onClick: event => { event.preventDefault(); onPropsChange?.({ rig: 'askar', page: 'capture' }) },
      label: `Askar FRA 400 capture. 17 captured. ${props.activity === 'interrupted' ? 'Updates lost. Last known count.' : props.activity === 'reading' ? 'Reading image.' : 'Current exposure 18 of 60 seconds.'} Open capture.`,
      ...(props.rig !== 'askar' ? { rigName: 'Askar' } : {}),
      completedCount: 17,
      status: props.activity === 'interrupted' ? 'Updates lost' : props.activity === 'reading' ? 'Reading image' : '18 / 60s',
      interrupted: props.activity === 'interrupted',
      ...(props.activity === 'exposing' ? { progress: { value: 18, max: 60 } } : {}),
      ...(props.activity === 'interrupted' ? { note: 'Last known · open Capture →' } : props.activity === 'reading' ? { note: 'Waiting for image →' } : {}),
    } })}
  />,
}
