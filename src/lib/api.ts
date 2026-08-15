const apiBaseUrl = import.meta.env.VITE_API_URL ?? '/api'

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
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
    throw new ApiError(`Request failed with ${response.status}`, response.status)
  }

  return response.json() as Promise<T>
}
