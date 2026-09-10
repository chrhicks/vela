import type { DesignProfile, WorkingSession } from '@vela/ui/themes'
// Keep the source-backed theme entry bundled when Vite loads its Node config.
// A package import is externalized and leaves Node with extensionless TS imports.
import { isDesignProfile, isWorkingSession } from '../../../packages/ui/src/themes/index'

export interface WorkshopPersistence {
  session: WorkingSession | null
  profiles: DesignProfile[]
}

export function parseSession(value: unknown): WorkingSession {
  if (!isWorkingSession(value)) throw new Error('Invalid workshop session payload')

  return value
}

export function parseProfile(value: unknown): DesignProfile {
  if (!isDesignProfile(value) || !isSafeProfileId(value.id)) {
    throw new Error('Invalid design profile payload')
  }

  if (value.readonly) throw new Error('Read-only profiles cannot be persisted')

  return value
}

export function isSafeProfileId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
}
