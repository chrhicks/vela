import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_PROFILE,
  DEFAULT_SESSION,
  VELA_CURRENT_PROFILE,
  makeProfile,
  resolveTheme,
} from '@vela/ui/themes'
import type { DesignProfile, ThemeParameters, WorkingSession } from '@vela/ui/themes'
import { loadProfiles, loadSession, persistProfile, persistSession } from './api'
import { findSpecimen } from './registry'

type SessionPatch = Partial<Omit<WorkingSession, 'schemaVersion' | 'updatedAt'>>

function sessionFromUrl(base: WorkingSession): WorkingSession {
  const params = new URLSearchParams(window.location.search)
  const hasExplicitSpecimen = params.has('component') || params.has('specimen')
  const next = { ...base, props: hasExplicitSpecimen ? {} : { ...base.props } }

  if (params.get('component')) next.componentId = params.get('component') ?? next.componentId

  if (params.get('specimen')) next.specimenId = params.get('specimen') ?? next.specimenId

  if (params.get('profile')) next.profileId = params.get('profile') ?? next.profileId

  if (params.get('mode') === 'light' || params.get('mode') === 'dark') next.mode = params.get('mode') as 'light' | 'dark'

  if (['isolated', 'form', 'toolbar', 'card'].includes(params.get('context') ?? '')) next.context = params.get('context') as WorkingSession['context']
  const viewport = Number(params.get('viewport'))

  if (viewport >= 320 && viewport <= 1600) next.viewport = viewport

  for (const [key, value] of params) {
    if (key.startsWith('prop.')) next.props[key.slice(5)] = value === 'true' ? true : value === 'false' ? false : value
  }

  return next
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 64)
}

export function useWorkshop() {
  const [session, setSession] = useState<WorkingSession>(DEFAULT_SESSION)
  const [profiles, setProfiles] = useState<DesignProfile[]>([DEFAULT_PROFILE, VELA_CURRENT_PROFILE])
  const [hydrated, setHydrated] = useState(false)
  const [status, setStatus] = useState('Loading local workspace…')
  const [undoStack, setUndoStack] = useState<Partial<ThemeParameters>[]>([])
  const [redoStack, setRedoStack] = useState<Partial<ThemeParameters>[]>([])
  const saveTimer = useRef<number | undefined>(undefined)

  useEffect(() => {
    Promise.all([loadSession(), loadProfiles()])
      .then(([storedSession, storedProfiles]) => {
        const nextSession = sessionFromUrl(storedSession ?? DEFAULT_SESSION)
        const discovered = [DEFAULT_PROFILE, VELA_CURRENT_PROFILE, ...storedProfiles]

        if (!discovered.some((profile) => profile.id === nextSession.profileId)) nextSession.profileId = DEFAULT_PROFILE.id
        const specimen = findSpecimen(nextSession.componentId, nextSession.specimenId)
        nextSession.componentId = specimen.componentId
        nextSession.specimenId = specimen.id
        nextSession.props = { ...specimen.defaultProps, ...nextSession.props }
        setProfiles(discovered)
        setSession(nextSession)
        setHydrated(true)
        setStatus(storedSession ? 'Session recovered from disk' : 'New local session')
      })
      .catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'Unable to load workshop state'))
  }, [])

  useEffect(() => {
    if (!hydrated) return
    window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      const persisted = { ...session, updatedAt: new Date().toISOString() }
      persistSession(persisted)
        .then(() => setStatus('Session recovered automatically'))
        .catch((error: unknown) => setStatus(error instanceof Error ? error.message : 'Session save failed'))
    }, 280)
    const params = new URLSearchParams()
    params.set('component', session.componentId)
    params.set('specimen', session.specimenId)
    params.set('profile', session.profileId)
    params.set('mode', session.mode)
    params.set('context', session.context)
    params.set('viewport', String(session.viewport))

    for (const [key, value] of Object.entries(session.props)) params.set(`prop.${key}`, String(value))
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)

    return () => window.clearTimeout(saveTimer.current)
  }, [hydrated, session])

  const activeProfile = profiles.find((profile) => profile.id === session.profileId) ?? DEFAULT_PROFILE

  const theme = useMemo(
    () => resolveTheme(activeProfile, { ...session.unsavedOverrides, density: session.density }),
    [activeProfile, session.density, session.unsavedOverrides],
  )

  const specimen = findSpecimen(session.componentId, session.specimenId)

  const patchSession = useCallback((patch: SessionPatch) => {
    setSession((current) => ({ ...current, ...patch, updatedAt: current.updatedAt }))
  }, [])

  const patchProps = useCallback((patch: Record<string, string | number | boolean>) => {
    setSession((current) => ({
      ...current,
      props: { ...current.props, ...patch },
      updatedAt: current.updatedAt,
    }))
  }, [])

  const selectSpecimen = useCallback((componentId: string, specimenId: string) => {
    const next = findSpecimen(componentId, specimenId)
    patchSession({ componentId, specimenId, props: { ...next.defaultProps } })
  }, [patchSession])

  const editTheme = useCallback((patch: Partial<ThemeParameters>) => {
    setSession((current) => {
      setUndoStack((stack) => [...stack.slice(-39), current.unsavedOverrides])
      setRedoStack([])

      return { ...current, unsavedOverrides: { ...current.unsavedOverrides, ...patch } }
    })
  }, [])

  const undo = useCallback(() => {
    const previous = undoStack.at(-1)

    if (!previous) return
    setRedoStack((stack) => [session.unsavedOverrides, ...stack].slice(0, 40))
    setUndoStack((stack) => stack.slice(0, -1))
    patchSession({ unsavedOverrides: previous })
  }, [patchSession, session.unsavedOverrides, undoStack])

  const redo = useCallback(() => {
    const next = redoStack[0]

    if (!next) return
    setUndoStack((stack) => [...stack, session.unsavedOverrides].slice(-40))
    setRedoStack((stack) => stack.slice(1))
    patchSession({ unsavedOverrides: next })
  }, [patchSession, redoStack, session.unsavedOverrides])

  const selectProfile = useCallback((profileId: string) => {
    const profile = profiles.find((candidate) => candidate.id === profileId) ?? DEFAULT_PROFILE
    const resolved = resolveTheme(profile)
    setUndoStack([])
    setRedoStack([])
    patchSession({ profileId: profile.id, unsavedOverrides: {}, density: resolved.density })
  }, [patchSession, profiles])

  const save = useCallback(async () => {
    if (activeProfile.readonly) return false
    const next = { ...activeProfile, overrides: { ...activeProfile.overrides, ...session.unsavedOverrides } }
    const saved = await persistProfile(next)
    setProfiles((current) => current.map((profile) => profile.id === saved.id ? saved : profile))
    patchSession({ unsavedOverrides: {} })
    setUndoStack([])
    setRedoStack([])
    setStatus(`Saved ${saved.name}`)

    return true
  }, [activeProfile, patchSession, session.unsavedOverrides])

  const saveAs = useCallback(async (name: string) => {
    const id = slugify(name)

    if (!id) throw new Error('Profile name must contain a letter or number')
    const next = makeProfile(id, name.trim(), { ...activeProfile.overrides, ...session.unsavedOverrides })
    const saved = await persistProfile(next)
    setProfiles((current) => [...current.filter((profile) => profile.id !== saved.id), saved])
    patchSession({ profileId: saved.id, unsavedOverrides: {} })
    setUndoStack([])
    setRedoStack([])
    setStatus(`Saved ${saved.name}`)
  }, [activeProfile.overrides, patchSession, session.unsavedOverrides])

  return {
    activeProfile,
    editTheme,
    hydrated,
    patchProps,
    patchSession,
    profiles,
    redo,
    redoCount: redoStack.length,
    save,
    saveAs,
    selectProfile,
    selectSpecimen,
    session,
    specimen,
    status,
    theme,
    undo,
    undoCount: undoStack.length,
  }
}
