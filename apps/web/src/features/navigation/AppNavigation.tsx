import type { NavigationCapture } from '@vela/model/web'
import { NavigationBar, type NavigationActivity, type NavigationBarProps } from '@vela/ui'
import type { MouseEvent } from 'react'
import { useEffect, useRef } from 'react'
import { matchPath, useLocation, useNavigate } from 'react-router'
import { useNavigation } from './use-navigation'

export function AppNavigation() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { view, activity, offline, missing } = useNavigation()
  const rigId = matchPath('/rigs/:rigId/*', pathname)?.params.rigId ?? ''
  const base = rigId ? `/rigs/${encodeURIComponent(rigId)}` : ''
  const targets = useRef(new Map<string, string>())
  const inTargets = pathname.startsWith(`${base}/observe/targets`)

  useEffect(() => {
    if (rigId && inTargets) targets.current.set(rigId, search)
  }, [rigId, inTargets, search])

  const targetSearch = inTargets ? search : (targets.current.get(rigId) ?? '')

  const currentPage = inTargets
    ? 'Targets'
    : pathname.startsWith(`${base}/observe/capture`)
      ? 'Capture'
      : 'Observe'

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

  if (activity && presentation) {
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
      onRigChange={id => navigate(id ? `/rigs/${encodeURIComponent(id)}/observe` : '/')}
      links={
        rigId
          ? [
              {
                label: 'Observe',
                ...routeLink(`${base}/observe`),
                current: currentPage === 'Observe',
              },
              {
                label: 'Targets',
                ...routeLink(`${base}/observe/targets${targetSearch}`),
                current: currentPage === 'Targets',
              },
              {
                label: 'Capture',
                ...routeLink(`${base}/observe/capture`),
                current: currentPage === 'Capture',
              },
            ]
          : []
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
