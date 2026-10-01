import type { NavigationCapture } from '@vela/model/web'
import {
  Appearance,
  NavigationBar,
  type NavigationActivity,
  type NavigationBarProps,
} from '@vela/ui'
import type { MouseEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import { useAppearance } from '../../appearance/AppearanceProvider'
import { useRigObservation } from '../rig-detail/RigContext'
import { rigConnectionLabel } from './rig-connection'
import { useNavigation } from './use-navigation'

export function AppNavigation() {
  const appearance = useAppearance()
  const [appearanceOpen, setAppearanceOpen] = useState(false)
  const rig = useRigObservation()
  const connection = rig ? rigConnectionLabel(rig) : undefined
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { view, activity, offline, missing } = useNavigation()
  const rigId = matchPath('/rigs/:rigId/*', pathname)?.params.rigId ?? ''
  const base = rigId ? `/rigs/${encodeURIComponent(rigId)}` : ''
  const targets = useRef(new Map<string, string>())
  const inTargets = pathname.startsWith(`${base}/observe/targets`)
  const inPhotographs = pathname.startsWith(`${base}/observe/saved-images`)

  const inPreparation =
    pathname === `${base}/observe/alignment` || pathname === `${base}/observe/autofocus`

  useEffect(() => {
    if (rigId && inTargets) targets.current.set(rigId, search)
  }, [rigId, inTargets, search])

  const targetSearch = inTargets ? search : (targets.current.get(rigId) ?? '')

  const routeLink = (href: string) => ({
    href,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
        return
      event.preventDefault()
      navigate(href)
    },
  })

  const rigs = [{ id: '', name: 'All rigs' }, ...(view?.rigs ?? [])]

  if (rigId && !rigs.some(rig => rig.id === rigId)) rigs.push({ id: rigId, name: 'Current rig' })
  const presentation = activity ? activityPresentation(activity, offline, missing) : null

  const activityProps: Pick<NavigationBarProps, 'activity'> = {}

  // Tonight already shows this rig's full capture state. Keep the navigation
  // indicator when observing other pages or another rig.
  const showingActiveCapture = activity?.rigId === rigId && pathname === `${base}/observe/capture`

  if (activity && presentation && !showingActiveCapture) {
    const current: NavigationActivity = {
      ...routeLink(`/rigs/${encodeURIComponent(activity.rigId)}/observe/capture`),
      label: `${activity.rigName}. ${activity.completedCount} captured. ${presentation.status}. ${presentation.interrupted ? 'Last known count. Current outcome unknown. ' : ''}Open capture.`,
      completedCount: activity.completedCount,
      ...presentation,
    }

    if (activity.rigId !== rigId) current.rigName = activity.rigName
    activityProps.activity = current
  }

  return (
    <NavigationBar
      home={routeLink('/')}
      rigs={rigs}
      currentRigId={rigId}
      {...(inPreparation
        ? {
            compact: {
              back: { label: '← Tonight', ...routeLink(`${base}/observe/capture`) },
              label: rig?.view?.name ?? rigs.find(item => item.id === rigId)?.name ?? 'Current rig',
            },
          }
        : {})}
      onRigChange={id =>
        navigate(
          id
            ? `/rigs/${encodeURIComponent(id)}/observe/${inPhotographs ? 'saved-images' : 'capture'}`
            : '/',
        )
      }
      actions={
        <Appearance
          open={appearanceOpen}
          onOpenChange={setAppearanceOpen}
          value={appearance.preference}
          onValueChange={appearance.setPreference}
          systemMode={appearance.systemMode}
          persistence={appearance.persistence}
        />
      }
      utility={
        <>
          {connection && (
            <span className="vela-app__connection" data-connected={connection === 'Connected'}>
              <span className="vela-app__connection-dot" aria-hidden="true">
                ●
              </span>{' '}
              {connection}
            </span>
          )}
          {!rigId && view?.rigs.length === 0 && !offline && !missing && (
            <span className="vela-app__connection">No rig added</span>
          )}
        </>
      }
      links={
        rigId
          ? [
              {
                label: 'Tonight',
                ...routeLink(`${base}/observe/capture`),
                current:
                  pathname === `${base}/observe/capture` ||
                  pathname === `${base}/observe` ||
                  inPreparation,
              },
              {
                label: 'Explore the sky',
                ...routeLink(`${base}/observe/targets${targetSearch}`),
                current: inTargets,
              },
              {
                label: 'Photographs',
                ...routeLink(`${base}/observe/saved-images`),
                current: inPhotographs,
              },
            ]
          : [
              {
                label: 'Explore the sky',
                ...routeLink('/explore'),
                current: pathname === '/explore',
              },
            ]
      }
      {...activityProps}
    />
  )
}

type ActivityPresentation = Pick<NavigationActivity, 'status' | 'note' | 'progress'> & {
  interrupted: boolean
}

function activityPresentation(
  activity: NavigationCapture,
  offline: boolean,
  missing: boolean,
): ActivityPresentation {
  if (missing)
    return { status: 'Tracking lost', note: 'Last known · open Capture →', interrupted: true }

  if (offline)
    return { status: 'Updates lost', note: 'Last known · open Capture →', interrupted: true }

  if (activity.captureReadState === 'retrying')
    return {
      status: 'Awaiting camera',
      note: 'Retrying same exposure · open Capture →',
      interrupted: true,
    }

  switch (activity.phase) {
    case 'exposing': {
      const elapsed = Math.min(activity.elapsedSeconds, activity.exposureSeconds)
      const seconds = (value: number) => Number(value.toFixed(1)).toString()

      return {
        status: `${seconds(elapsed)} / ${seconds(activity.exposureSeconds)}s`,
        interrupted: false,
        progress: { value: elapsed, max: activity.exposureSeconds },
      }
    }

    case 'reading':
      return { status: 'Reading image', note: 'Open Capture →', interrupted: false }
    case 'saving':
      return { status: 'Saving image', note: 'Open Capture →', interrupted: false }
    case 'stopping':
      return { status: 'Stopping', note: 'Open Capture →', interrupted: false }
    case 'failed':
      return { status: 'Capture failed', note: 'Open Capture for details →', interrupted: false }
    default:
      return { status: 'Capture failed', note: 'Open Capture →', interrupted: false }
  }
}
