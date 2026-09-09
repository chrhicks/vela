import { NavigationBar } from '@vela/ui'
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
  const targetSearch = inTargets ? search : targets.current.get(rigId) ?? ''
  const currentPage = inTargets ? 'Targets' : pathname.startsWith(`${base}/observe/capture`) ? 'Capture' : 'Observe'
  const routeLink = (href: string) => ({ href, onClick: (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    navigate(href)
  } })
  const rigs = [{ id: '', name: 'All rigs' }, ...(view?.rigs ?? [])]
  if (rigId && !rigs.some(rig => rig.id === rigId)) rigs.push({ id: rigId, name: 'Current rig' })
  const interrupted = offline || missing
  const seconds = (value: number) => Number(value.toFixed(1)).toString()
  const elapsed = activity ? Math.min(activity.elapsedSeconds, activity.exposureSeconds) : 0
  const status = interrupted ? missing ? 'Tracking lost' : 'Updates lost' : activity?.phase === 'exposing'
    ? `${seconds(elapsed)} / ${seconds(activity.exposureSeconds)}s`
    : activity?.phase === 'reading' ? 'Reading image'
    : activity?.phase === 'saving' ? 'Saving image'
    : activity?.phase === 'stopping' ? 'Stopping' : 'Capture failed'
  const note = interrupted ? 'Last known · open Capture →' : activity?.phase === 'failed' ? 'Open Capture for details →'
    : activity?.phase === 'exposing' ? undefined : 'Open Capture →'

  return <NavigationBar home={routeLink('/')} rigs={rigs} currentRigId={rigId}
    onRigChange={id => navigate(id ? `/rigs/${encodeURIComponent(id)}/observe` : '/')}
    links={rigId ? [
      { label: 'Observe', ...routeLink(`${base}/observe`), current: currentPage === 'Observe' },
      { label: 'Targets', ...routeLink(`${base}/observe/targets${targetSearch}`), current: currentPage === 'Targets' },
      { label: 'Capture', ...routeLink(`${base}/observe/capture`), current: currentPage === 'Capture' },
    ] : []}
    {...(activity ? { activity: {
      ...routeLink(`/rigs/${encodeURIComponent(activity.rigId)}/observe/capture`),
      label: `${activity.rigName}. ${activity.completedCount} captured. ${status}. ${interrupted ? 'Last known count. Current outcome unknown. ' : ''}Open capture.`,
      ...(activity.rigId !== rigId ? { rigName: activity.rigName } : {}),
      completedCount: activity.completedCount, status, ...(note ? { note } : {}), interrupted,
      ...(!interrupted && activity.phase === 'exposing' ? { progress: { value: elapsed, max: activity.exposureSeconds } } : {}),
    } } : {})}
  />
}
