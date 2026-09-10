import { z } from 'zod'
import { designProfileSchema, workingSessionSchema } from '@vela/ui/themes'
import type { DesignProfile, WorkingSession } from '@vela/ui/themes'

const sessionResponse = z.object({ session: workingSessionSchema.nullable() })

const profile = designProfileSchema

const profileResponse = z.object({ profile })

const profilesResponse = z.object({ profiles: z.array(profile) })

const failureResponse = z.object({ error: z.string().optional() })

async function request<T>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json()

  if (!response.ok) {
    const failure = failureResponse.safeParse(value)
    throw new Error(failure.success ? failure.data.error ?? `Request failed: ${response.status}` : `Request failed: ${response.status}`)
  }

  return schema.parse(value)
}

export async function loadSession(): Promise<WorkingSession | null> {
  return (await request('/__workshop/session', sessionResponse)).session
}

export async function persistSession(session: WorkingSession): Promise<void> {
  await request('/__workshop/session', sessionResponse, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session),
  })
}

export async function loadProfiles(): Promise<DesignProfile[]> {
  return (await request('/__workshop/profiles', profilesResponse)).profiles
}

export async function persistProfile(profile: DesignProfile): Promise<DesignProfile> {
  return (await request(`/__workshop/profiles/${profile.id}`, profileResponse, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  })).profile
}
