import { NavigationBar, type NavigationActivity, type NavigationBarProps } from './NavigationBar'
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
  render: (props, onPropsChange) => {
    const navigation: Pick<NavigationBarProps, 'activity'> = {}

    if (props.activity !== 'none') {
      const activity: NavigationActivity = {
        href: '#capture',
        onClick: event => { event.preventDefault(); onPropsChange?.({ rig: 'askar', page: 'capture' }) },
        label: 'Askar FRA 400 capture. 17 captured. Current exposure 18 of 60 seconds. Open capture.',
        completedCount: 17,
        status: '18 / 60s',
        interrupted: props.activity === 'interrupted',
      }

      if (props.rig !== 'askar') activity.rigName = 'Askar'

      switch (props.activity) {
        case 'interrupted':
          activity.label = 'Askar FRA 400 capture. 17 captured. Updates lost. Last known count. Open capture.'
          activity.status = 'Updates lost'
          activity.note = 'Last known · open Capture →'
          break
        case 'reading':
          activity.label = 'Askar FRA 400 capture. 17 captured. Reading image. Open capture.'
          activity.status = 'Reading image'
          activity.note = 'Waiting for image →'
          break
        case 'exposing':
          activity.progress = { value: 18, max: 60 }
          break
      }

      navigation.activity = activity
    }

    return <NavigationBar
      home={{ href: '#rigs', onClick: event => { event.preventDefault(); onPropsChange?.({ rig: 'all' }) } }}
      rigs={[{ id: 'all', name: 'All rigs' }, { id: 'askar', name: 'Askar FRA 400' }, { id: 'seestar', name: 'Seestar S30' }]}
      currentRigId={String(props.rig)}
      onRigChange={rig => onPropsChange?.({ rig })}
      links={props.rig === 'all' ? [] : ['observe', 'targets', 'capture'].map(page => ({ href: `#${page}`, label: page[0]!.toUpperCase() + page.slice(1), current: props.page === page, onClick: event => { event.preventDefault(); onPropsChange?.({ page }) } }))}
      {...navigation}
    />
  },
}
