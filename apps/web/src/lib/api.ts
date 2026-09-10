import { z } from 'zod'

const json = z.json()

const apiFailure = z.object({ error: z.string() })

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
export async function api(path: string, init?: RequestInit) {
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
      const result = apiFailure.safeParse(await response.json())

      if (result.success) code = result.data.error
    } catch {
      // An error response may have no JSON body.
    }

    throw new ApiError(`Request failed with ${response.status}`, response.status, code)
  }

  if (response.status === 204) return undefined

  return json.parse(await response.json())
}
