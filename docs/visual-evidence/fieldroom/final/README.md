# Final Fieldroom verification

Reviewed application code: `cd404b8`, independent **OK** with no findings on
[PR #86](https://github.com/chrhicks/vela/pull/86#issuecomment-5923065413).
The final source comparison is accepted by the implementing agent. Chris's
whole-application browser acceptance remains required before merge.

## Evidence and comparison

[The manifest](manifest.json) records 88 captures from the reviewed code:

- 64 main-route captures across Tonight/Appearance, Explore, framing, capture
  preparation, Photographs, Equipment, Home and rig onboarding, in light/dark
  at desktop and phone widths (900px intermediate layouts where applicable).
- 15 supplemental state captures: collection loading, first exposure, no image,
  confirmed stopping, disconnected imaging camera, Home interaction states,
  reduced-motion enlargement and native Chromium touch panning.
- Nine Photographs collection captures: loading/empty at 1440/390px in both
  palettes and a directly selected photograph while collection loading is held.

Of the 64 main captures, 51 are byte-identical to their accepted slice artifacts;
the manifest points to those existing files without duplicating them. The other
13 are retained here, with prior-artifact links and exact difference bounds.
Their largest channel difference is 2/255; summed mean-channel differences are
at most 17 across an entire capture. Inspection found sparse border/corner
rasterization differences, with no changed text, layout, crop or state. No broad
screenshot tolerance was used to accept layout changes.

The parent inspected all nine new collection captures against frozen source 03.9
and the approved workshop states. Desktop cards preserve 440×294 geometry,
24px padding, 6px radius, 16px group gaps and the 46px footer. Phone cards use
350px available width and preserve the approved Barlow wrapping. The selected
image remains visible independently in the normal gallery columns. Existing
operational copy, confirmed counts and the shared Appearance control are
intentional application details, as recorded in the owning plan.

The parent also inspected the changed main captures and the 15 supplemental
states. Preparation retains its separately accepted [74 captures and 60 geometry
records](../alignment-autofocus/README.md); every paired light/dark geometry
record agrees. All 44 frozen Paper hashes and dimensions were rechecked unchanged.
The [coverage map](../../../visual-reference/fieldroom/coverage.md) relates
original planned scene names to actual fixtures and interactions.

## Reproduce

After independent OK, these commands passed **46 + 31 = 77** cases:

```sh
pnpm --filter @vela/web exec playwright test tests/tonight.e2e.ts tests/fieldroom-explore.e2e.ts tests/preparation.e2e.ts tests/photographs.e2e.ts tests/fieldroom-equipment.e2e.ts tests/rig-onboarding.e2e.ts --grep 'shows confirmed capture|keeps three reference|renders actual Aladin|shows the actual temporary|source composition|reference layout|review and address layouts|empty scan and unreachable'
pnpm --filter @vela/web exec playwright test tests/photographs-collection-states.e2e.ts tests/fieldroom-final-states.e2e.ts tests/appearance.e2e.ts tests/theme.e2e.ts tests/navigation.e2e.ts tests/preparation-navigation.e2e.ts
```

The independent verifier separately passed `pnpm check` (921 tests and workspace
builds), 170 application browser checks, seven workshop checks and four Python
tests. The corrected workshop foundation checks isolate saved session/profile
reads like Appearance checks; all 15 affected foundation/Appearance/collection
checks passed before that final review.

Screenshots use project Playwright Chromium at device scale 1. The native shared
browser confirmed Tonight at 1280×800, with fonts loaded, decoded 1280px imagery,
correct capture state and no horizontal overflow. Its screenshot tool remains
unavailable in this host; retained raster evidence comes from project Chromium,
not a claimed native screenshot. Environment-port navigation also failed on this
host; direct localhost navigation succeeded.

The review server (`pnpm exec tsx scripts/review-fieldroom.mts`, port 5176)
serves actual application routes with isolated deterministic contracts. Use
`/__review` to choose/reset a scene; global navigation is not a complete
cross-feature simulation. No physical-device commands were issued for this
acceptance. Physical alignment accuracy, exposure quality and actual focuser
restoration remain outside these fixture-based conclusions.
