import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const defaultCatalogUrl = new URL('../../../../data/rigs.yaml', import.meta.url)

export function resolveRigCatalogPath(override: string | undefined): string {
  return override === undefined
    ? fileURLToPath(defaultCatalogUrl)
    : resolve(override)
}
