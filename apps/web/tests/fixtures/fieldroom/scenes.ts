import { createTonightScene, tonightScenes } from './tonight'
import { createExploreScene, exploreScenes } from './explore'

export const reviewScenes = [...tonightScenes, ...exploreScenes]

export function createReviewScene(name: string) {
  const tonight = tonightScenes.find(scene => scene === name)
  const explore = exploreScenes.find(scene => scene === name)

  if (tonight) return createTonightScene(tonight)

  if (explore) return createExploreScene(explore)

  return undefined
}
