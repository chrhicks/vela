import type { DesignProfile, WorkingSession } from '@vela/ui/themes'

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json() as T & { error?: string }

  if (!response.ok) throw new Error(value.error ?? `Request failed: ${response.status}`)

  return value
}

export async function loadSession(): Promise<WorkingSession | null> {
  return (await request<{ session: WorkingSession | null }>('/__workshop/session')).session
}

export async function persistSession(session: WorkingSession): Promise<void> {
  await request('/__workshop/session', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(session),
  })
}

export async function loadProfiles(): Promise<DesignProfile[]> {
  return (await request<{ profiles: DesignProfile[] }>('/__workshop/profiles')).profiles
}

export async function persistProfile(profile: DesignProfile): Promise<DesignProfile> {
  return (await request<{ profile: DesignProfile }>(`/__workshop/profiles/${profile.id}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(profile),
  })).profile
}
