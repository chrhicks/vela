import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createRequestId } from './mount-control-api'

afterEach(() => vi.unstubAllGlobals())

describe('createRequestId', () => {
  it('creates distinct version 4 UUIDs the server accepts', () => {
    const ids = Array.from({ length: 1000 }, createRequestId)

    expect(new Set(ids).size).toBe(ids.length)

    for (const id of ids) {
      expect(z.uuid().safeParse(id).success, id).toBe(true)
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    }
  })

  it('works where randomUUID is unavailable, as on a plain-HTTP LAN origin', () => {
    const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

    vi.stubGlobal('crypto', { getRandomValues })
    expect(globalThis.crypto.randomUUID).toBeUndefined()
    expect(z.uuid().safeParse(createRequestId()).success).toBe(true)
  })
})
