import { open } from 'node:fs/promises'

export async function writeDurable(path: string, data: Buffer | string, openFile: typeof open) {
  const file = await openFile(path, 'wx')

  try {
    await file.writeFile(data)
    await file.sync()
  }
  finally { await file.close() }
}

export async function syncDirectory(path: string) {
  const directory = await open(path, 'r')

  try { await directory.sync() }
  finally { await directory.close() }
}
