export interface NamerOptions {
  readonly night: () => string
  readonly kept: (night: string) => Promise<ReadonlyArray<string>>
}

export function makeNamer({ night, kept }: NamerOptions) {
  const handedOut = new Map<string, number>()

  return async function nextName(sequence: string): Promise<string> {
    const tonight = night()
    const numbered = new RegExp(`^${sequence.replace(/[^A-Za-z0-9_-]/g, '')}_(\\d+)\\.fits$`)
    const files = await kept(tonight).catch(() => [])
    const highest = Math.max(0, ...files.map(file => Number(numbered.exec(file)?.[1] ?? 0)))
    const key = `${tonight}/${sequence}`
    const next = Math.max(highest, handedOut.get(key) ?? 0) + 1

    handedOut.set(key, next)

    return `${sequence}_${String(next).padStart(3, '0')}`
  }
}
