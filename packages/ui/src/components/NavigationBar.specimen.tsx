import { z } from 'zod'
import { useState } from 'react'
import { Appearance } from './Appearance'
import type { AppearancePreference } from './Appearance'
import { NavigationBar, type NavigationActivity, type NavigationBarProps } from './NavigationBar'
import type { ComponentSpecimen } from '../themes'
import './NavigationBar.specimen.css'

const connectionSchema = z.enum(['connected', 'interrupted', 'offline'])

function NavigationUtility({ connection }: { connection: z.infer<typeof connectionSchema> }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<AppearancePreference>('system')
  const connectionLabels = { connected: 'Connected', interrupted: 'Updates lost', offline: 'Offline' }

  return (
    <>
      <Appearance open={open} onOpenChange={setOpen} value={value} onValueChange={setValue} systemMode="light" persistence="visit" />
      <span className="vela-navigation-specimen__connection" data-state={connection}>
        <i aria-hidden="true" />
        {connectionLabels[connection]}
      </span>
    </>
  )
}

export const specimen: ComponentSpecimen = {
  componentId: 'navigation-bar',
  componentName: 'Navigation bar',
  id: 'navigation-bar-anatomy',
  name: 'Fieldroom navigation · Primitive anatomy',
  description:
    'Rig context, page links and optional capture activity. Callers own destinations, current state and progress.',
  controls: {
    compact: { type: 'boolean', label: 'Focused phone task' },
    rig: { type: 'select', label: 'Viewing rig', options: ['askar', 'seestar', 'all'] },
    page: { type: 'select', label: 'Current page', options: ['tonight', 'explore', 'photographs'] },
    connection: { type: 'select', label: 'Connection', options: ['connected', 'interrupted', 'offline'] },
    activity: {
      type: 'select',
      label: 'Activity',
      options: ['exposing', 'reading', 'interrupted', 'none'],
    },
  },
  defaultProps: { compact: false, rig: 'askar', page: 'tonight', connection: 'connected', activity: 'none' },
  render: (props, onPropsChange) => {
    const navigation: Pick<NavigationBarProps, 'activity'> = {}

    if (props.activity !== 'none') {
      const activity: NavigationActivity = {
        href: '#tonight',
        onClick: event => {
          event.preventDefault()
          onPropsChange?.({ rig: 'askar', page: 'tonight' })
        },
        label:
          'Askar FRA 400 capture. 17 captured. Current exposure 18 of 60 seconds. Open capture.',
        completedCount: 17,
        status: '18 / 60s',
        interrupted: props.activity === 'interrupted',
      }

      if (props.rig !== 'askar') activity.rigName = 'Askar'

      switch (props.activity) {
        case 'interrupted':
          activity.label =
            'Askar FRA 400 capture. 17 captured. Updates lost. Last known count. Open capture.'
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

    return (
      <NavigationBar
        home={{
          href: '#rigs',
          onClick: event => {
            event.preventDefault()
            onPropsChange?.({ rig: 'all' })
          },
        }}
        rigs={[
          { id: 'all', name: 'All rigs' },
          { id: 'askar', name: 'Askar FRA 400' },
          { id: 'seestar', name: 'Seestar S30' },
        ]}
        currentRigId={String(props.rig)}
        {...(props.compact ? { compact: {
          back: { href: '#tonight', label: '← Tonight', onClick: event => event.preventDefault() },
          label: props.rig === 'seestar' ? 'Seestar S30' : 'Askar FRA 400',
        } } : {})}
        onRigChange={rig => onPropsChange?.({ rig })}
        links={
          props.rig === 'all'
            ? []
            : [{ id: 'tonight', label: 'Tonight' }, { id: 'explore', label: 'Explore the sky' }, { id: 'photographs', label: 'Photographs' }].map(page => ({
                href: `#${page.id}`,
                label: page.label,
                current: props.page === page.id,
                onClick: event => {
                  event.preventDefault()
                  onPropsChange?.({ page: page.id })
                },
              }))
        }
        utility={<NavigationUtility connection={connectionSchema.parse(props.connection)} />}
        {...navigation}
      />
    )
  },
}
