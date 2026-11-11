import { useSearchParams } from 'react-router'

export function useScene<Name extends string>(names: readonly [Name, ...Name[]]): Name {
  const [search] = useSearchParams()
  const asked = search.get('scene')

  return names.find(name => name === asked) ?? names[0]
}
