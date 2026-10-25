import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'

/** Whether a rig's alerts may reach the phone. Chris sets it; the default is on. */
export interface PhoneAlertsPreference {
  isOn(rigId: string): boolean
  set(rigId: string, on: boolean): Promise<void>
}

const fileSchema = z.strictObject({ phoneAlerts: z.record(z.string(), z.boolean()) })

export function createMemoryPhoneAlertsPreference(): PhoneAlertsPreference {
  const choices = new Map<string, boolean>()

  return {
    isOn: rigId => choices.get(rigId) ?? true,
    async set(rigId, on) {
      choices.set(rigId, on)
    },
  }
}

export async function openFilePhoneAlertsPreference(path: string): Promise<PhoneAlertsPreference> {
  const choices = new Map(Object.entries(await readChoices(path)))
  let pending = Promise.resolve()

  return {
    isOn: rigId => choices.get(rigId) ?? true,

    set(rigId, on) {
      const write = async () => {
        const next = new Map(choices).set(rigId, on)

        await writeChoices(path, Object.fromEntries(next))

        choices.set(rigId, on)
      }

      const result = pending.then(write, write)
      pending = result.catch(() => undefined)

      return result
    },
  }
}

async function readChoices(path: string) {
  let contents: string

  try {
    contents = await readFile(path, 'utf8')
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {}
    throw error
  }

  let input: unknown

  try {
    input = JSON.parse(contents)
  } catch {
    throw new Error(`Invalid phone alerts preference in ${path}: (root): Invalid JSON`)
  }

  const parsed = fileSchema.safeParse(input)

  if (!parsed.success) {
    const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; ')

    throw new Error(`Invalid phone alerts preference in ${path}: ${issues}`)
  }

  return parsed.data.phoneAlerts
}

async function writeChoices(path: string, phoneAlerts: Record<string, boolean>) {
  const temporaryPath = `${path}.${randomUUID()}.tmp`

  await mkdir(dirname(path), { recursive: true })

  try {
    await writeFile(temporaryPath, `${JSON.stringify({ phoneAlerts }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    await rename(temporaryPath, path)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {})
    throw error
  }
}
