const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

/** Fetch JSON from the application's API. Never put secrets in VITE_* variables. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...init?.headers,
    },
  })

  if (!response.ok) {
    let code: string | undefined
    try {
      const body: unknown = await response.json()
      if (isRecord(body) && typeof body.error === 'string') code = body.error
    } catch {
      // An error response may have no JSON body.
    }
    throw new ApiError(`Request failed with ${response.status}`, response.status, code)
  }
  if (response.status === 204) return undefined as T

  return response.json() as Promise<T>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
