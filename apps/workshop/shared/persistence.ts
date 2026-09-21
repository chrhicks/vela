import { z } from 'zod'
import type { DesignProfile, WorkingSession } from '@vela/ui/themes'
// Keep the source-backed theme entry bundled when Vite loads its Node config.
// A package import is externalized and leaves Node with extensionless TS imports.
import { isDesignProfile, isWorkingSession } from '../../../packages/ui/src/themes/index'

export interface WorkshopPersistence {
  session: WorkingSession | null
  profiles: DesignProfile[]
}

const sessionPayload = z.custom<WorkingSession>(
  isWorkingSession,
  'Invalid workshop session payload',
)

const profilePayload = z
  .custom<DesignProfile>(isDesignProfile, 'Invalid design profile payload')
  .refine(value => isSafeProfileId(value.id), 'Invalid design profile payload')
  .refine(value => !value.readonly, 'Read-only profiles cannot be persisted')

export const parseSession = sessionPayload.parse

export const parseProfile = profilePayload.parse

export function isSafeProfileId(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value)
}
