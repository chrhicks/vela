import { createEquipmentScene, equipmentScenes } from './equipment'
import { createTonightScene, tonightScenes } from './tonight'
import { createPhotographsScene, photographsScenes } from './photographs'
import { createExploreScene, exploreScenes } from './explore'

export const reviewScenes = [...tonightScenes, ...exploreScenes, ...photographsScenes, ...equipmentScenes]

export function createReviewScene(name: string) {
  const equipment = equipmentScenes.find(scene => scene === name)
  const tonight = tonightScenes.find(scene => scene === name)
  const photographs = photographsScenes.find(scene => scene === name)
  const explore = exploreScenes.find(scene => scene === name)

  if (equipment) return createEquipmentScene(equipment)

  if (tonight) return createTonightScene(tonight)

  if (explore) return createExploreScene(explore)

  if (photographs) return createPhotographsScene(photographs)

  return undefined
}
