import { createHash } from 'node:crypto'
import { EquipmentError } from '@vela/equipment'
import { z } from 'zod'
import { CriaApiError } from './error.js'
import { CriaErrorSchema, type CriaValue } from './schema.js'

const jsonLimit = 4 * 1024 * 1024

export class CriaHttp {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly fetch: typeof globalThis.fetch,
    private readonly timeoutMs: number,
  ) {}

  private invalid(message: string, path: string): EquipmentError {
    return new EquipmentError(message, { reason: 'invalid-response', endpoint: path })
  }

  private async jsonBody(response: Response, path: string): Promise<CriaValue> {
    if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/json')
      throw this.invalid('Cria returned a non-JSON response', path)

    if (!response.body) throw this.invalid('Cria returned an empty response', path)

    const reader = response.body.getReader()
    const chunks: Uint8Array[] = []
    let length = 0
    let complete = false

    try {
      for (;;) {
        const { done, value } = await reader.read()

        if (done) break
        length += value.byteLength

        if (length > jsonLimit) throw this.invalid('Cria JSON response exceeds its bound', path)
        chunks.push(value)
      }

      complete = true

      return z.json().parse(JSON.parse(Buffer.concat(chunks, length).toString('utf8')))
    } finally {
      if (!complete) await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }

  private async response<T>(
    path: string,
    method: string,
    body: string | undefined,
    timeoutMs: number,
    consume: (response: Response) => Promise<T>,
  ): Promise<T> {
    const url = new URL(path, this.baseUrl)

    if (url.origin !== new URL(this.baseUrl).origin || !path.startsWith('/v2/'))
      throw this.invalid('Cria request escaped its configured endpoint', path)

    try {
      const headers = new Headers({ authorization: `Bearer ${this.token}` })

      if (body !== undefined) headers.set('content-type', 'application/json')

      const init: RequestInit = {
        method,
        headers,
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      }

      if (body !== undefined) init.body = body
      const response = await this.fetch(url, init)

      if (!response.ok) {
        const error = CriaErrorSchema.parse(await this.jsonBody(response, path))

        throw new CriaApiError(
          response.status,
          error.error.code,
          error.error.message.replaceAll(this.token, '[redacted]'),
          path,
        )
      }

      return await consume(response)
    } catch (error) {
      if (error instanceof EquipmentError) throw error

      throw new EquipmentError(
        error instanceof z.ZodError || error instanceof SyntaxError
          ? 'Cria returned an invalid response'
          : 'Cria request did not complete',
        {
          reason: error instanceof z.ZodError || error instanceof SyntaxError
            ? 'invalid-response'
            : 'transport',
          endpoint: path,
          cause: error,
        },
      )
    }
  }

  json<T>(path: string, schema: z.ZodType<T>, method = 'GET', body?: string): Promise<T> {
    if (body !== undefined && Buffer.byteLength(body) > 16384)
      throw this.invalid('Cria operation request exceeds its bound', path)

    return this.response(path, method, body, this.timeoutMs, async response =>
      schema.parse(await this.jsonBody(response, path)))
  }

  original(path: string, expectedBytes: number, sha256: string, timeoutMs: number): Promise<ArrayBuffer> {
    return this.response(path, 'GET', undefined, timeoutMs, async response => {
      if (response.headers.get('content-type')?.split(';')[0]?.trim() !== 'application/imagebytes' ||
        response.headers.get('content-length') !== String(expectedBytes) || !response.body)
        throw this.invalid('Cria original headers do not match retained metadata', path)
      const etag = response.headers.get('etag')

      if (etag !== null && etag !== `"${sha256}"`)
        throw this.invalid('Cria original checksum header changed', path)

      const bytes = new ArrayBuffer(expectedBytes)
      const output = new Uint8Array(bytes)
      const hash = createHash('sha256')
      const reader = response.body.getReader()
      let offset = 0
      let complete = false

      try {
        for (;;) {
          const { done, value } = await reader.read()

          if (done) break

          if (offset + value.byteLength > expectedBytes)
            throw this.invalid('Cria original exceeds its declared length', path)
          output.set(value, offset)
          hash.update(value)
          offset += value.byteLength
        }

        complete = true

        if (offset !== expectedBytes || hash.digest('hex') !== sha256)
          throw this.invalid('Cria original integrity check failed', path)

        return bytes
      } finally {
        if (!complete) await reader.cancel().catch(() => {})
        reader.releaseLock()
      }
    })
  }
}
