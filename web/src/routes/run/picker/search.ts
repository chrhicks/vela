import type { Target } from './stub.ts'

const squash = (text: string) => text.toLowerCase().replaceAll(/[\s-]/g, '')

export function matching(targets: ReadonlyArray<Target>, typed: string): ReadonlyArray<Target> {
  const wanted = squash(typed)

  if (wanted === '') return targets.filter(target => target.up)

  const found = targets.filter(target => [target.name, target.common, ...target.also].some(name => squash(name).includes(wanted)))

  return [...found.filter(target => target.up), ...found.filter(target => !target.up)]
}
