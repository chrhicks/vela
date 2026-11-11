import { useSearchParams } from 'react-router'

export type FilterAnswer = 'in' | 'out'

export function useFilterAnswer(): FilterAnswer {
  const [search] = useSearchParams()

  return search.get('filter') === 'out' ? 'out' : 'in'
}
