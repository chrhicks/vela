import surveyManifest from './survey-manifest.json' with { type: 'json' }
import { referenceImage } from './tonight'

/** Simulator pixels, not a new exposure or measured WCS. See the fixture README. */
export const alignmentResource = {
  resource: 'alignment-star-field',
  path: 'packages/ui/src/components/fixtures/capture-star-field.png',
  sha256: '32fc1935092d3d98768c18e21c94829f6134262524cd302133bbf1f269099f4c',
  contentType: 'image/png',
}

/** Exact local resources only. No network fallback or pathname-to-filesystem mapping. */
export const reviewResources = [
  alignmentResource,
  { resource: 'crescent', ...referenceImage, contentType: 'image/jpeg' },
  {
    resource: 'andromeda',
    path: 'packages/ui/src/drafts/target-framing/andromeda.jpg',
    sha256: 'af67cc41ad424694b925adca949fb10091198a89343fb1629d830a6007169ffc',
    contentType: 'image/jpeg',
  },
  {
    resource: 'm13',
    path: 'packages/ui/src/drafts/target-framing/m13.jpg',
    sha256: 'eddd9e504c7ff15f4fc5fa44f4183af61d0be19c8b5aa1d872be51a3335e474b',
    contentType: 'image/jpeg',
  },
  {
    resource: 'photographs-fits',
    path: 'apps/web/tests/fixtures/fieldroom/photographs-synthetic.fits',
    sha256: '654a8b6216f30ea4c13489fe69dfc9078fdfcde9112c29dbf6496b33d9a9f49e',
    contentType: 'application/fits',
  },
  ...surveyManifest,
]

export function reviewResource(resource: string) {
  return reviewResources.find(item => item.resource === resource)
}
