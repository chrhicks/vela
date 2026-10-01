# Fieldroom capability additions

Planned before implementation. These are narrow dependencies of the visual
slices in [Fieldroom adoption](fieldroom-adoption.md), not a new observing
session, sequence, or workflow subsystem. Implement each with its consuming
slice and record actual outcomes below.

## Capture subject and run totals — Tonight dependency

Owners: `packages/model/src/web/capture.ts`, server capture controller/routes,
saved-image metadata validation, `apps/server/src/app.ts` composition, and web
capture validation/handoff. Read the capture and saved-images READMEs before
edits and update their contracts with the implementation.

- Add a small subject snapshot containing target ID, name, and catalog identity.
  Capture start may carry the selected target ID; resolve and validate it before
  acquiring/commanding hardware. Inject a narrow subject lookup at composition.
  Capture must not import the targets implementation or own catalog enrichment.
- The active run owns an immutable subject-intent snapshot. It describes what
  Chris chose, not proof of pointing or a current solved frame. Target changes
  elsewhere do not rewrite a running exposure's identity. A start without a
  target has explicit absent subject intent.
- Copy that subject onto retained image metadata when available. Accept old
  artifacts without the field; do not migrate or invalidate existing images.
- Add per-run saved count and collected integration seconds. Integration sums
  the durations of images actually published; interrupted/unpublished exposures
  contribute nothing. Keep the existing archive `savedImageCount` semantics.
- Reset run totals only on a new accepted run. Idempotent Keep and automatic
  save must count each image once. Keeping an image from an older run must not
  increment the current run's saved count. Use a private generation identity
  associated with cached frames, not a public durable run-history model.
- Preserve server ownership, restart interruption, camera-read retries, the
  exclusive operation lease, Stop cleanup, and uncertain-write behavior.

Focused proof: invalid/unknown target rejected before any physical command;
subject snapshot remains stable through target/UI changes; targetless start;
old artifacts still load; counts on publication, automatic save, explicit Keep,
repeat Keep, failed save, Stop race, and old-run Keep during a new run. Existing
capture cancellation and ambiguous-cleanup cases remain intact.

## Held image inspection — Tonight and Photographs dependency

Owners: `apps/web/src/features/capture/LatestImage.tsx` and its image-loading/
retention helpers, current image viewport utility boundary, saved-image detail
composition, related CSS, and production-route browser fixtures.

- Separate which frame is displayed from whether the viewer follows new frames.
  Entering native scale or enlargement holds the currently loaded identity;
  subsequent acquisitions must not silently replace the inspected image.
- Keep fitted/native URLs, metadata, dimensions, save state, and viewport tied
  to that identity. Native loading keeps the fitted image visible until the
  matching native bytes decode. A slow/failed request must not publish another
  frame's metadata or a mismatched viewport.
- Show latest explicitly returns to the newest frame and fitted view. Retry
  retries the same image GET. Keep always names the visible image; completion
  feedback remains attached to it even when another frame arrives.
- Enlargement preserves frame/scale/pan and returns focus appropriately. Reuse
  established accessible dialog behavior without importing polar-alignment
  astronomy overlays into generic image inspection. Support bounded pointer,
  touch, and keyboard panning at native scale.
- The existing server cache is bounded to three image pairs. An old unsaved
  held frame can expire: preserve already loaded pixels, explain unavailable
  native/download/Keep operations, and never substitute another frame.

Focused proof: new frame arriving during native load/inspection/Keep; explicit
Show latest; failed exact-image GET and retry; expired frame; enlarged return
and focus; theme changes preserve image identity/viewport. Prefer real-route
browser behavior tests for image decoding, panning, and focus.

## Framing exposure preview — Explore/framing dependency

Owners: server `targets/framing.ts` and routes, existing imaging preview
capability, `packages/model/src/web/targets.ts`, web framing validation and
composition. Keep raw pixels and wire details at existing adapters.

- Render a fitted preview from the actual test exposure at the framing
  measurement boundary. Retain it in a small bounded cache and expose an
  explicit preview identity/URL, native dimensions, exposure duration,
  acquisition time/source, and nullable checked-solution identity.
- An unsolved exposure can still be inspected, but it must not borrow an older
  solution's authority. Keep stale check identity and newer preview identity
  distinguishable. Do not claim reference survey artwork is a rig exposure.
- Preview rendering failure must not invalidate a successful solve or cause a
  slew/exposure to replay. Report preview availability independently. No FITS
  retention workflow or additional hardware command is introduced.

Focused proof: solved/unsolved preview identity, solve success with preview
failure, bounded expiry, check staleness, and no extra physical commands. Keep
existing slew ambiguity and no-automatic-retry tests intact.

## Catalog facts — Tonight and Explore dependency

Owners: `apps/server/src/targets/catalog/{generate.py,types.ts,data.ts}` and
catalog tests, relevant shared target projection and browser validation.

The pinned OpenNGC source has `Const`, currently discarded. Retain and expand
its constellation code, including the source's Serpens subdivision codes.
Distance is absent: show “Distance unavailable” where the approved layout has
that row, and record this deliberate content substitution in visual evidence.
Do not invent a distance, add an always-null API field, derive it from unrelated
measurements, or introduce live enrichment. Existing angular major/minor sizes
can support descriptions where already supplied.

Focused proof: generated constellation retention/name mapping and projection
validation, including source edge codes; existing catalog generation remains
deterministic. These facts provide context, never operational pointing proof.

## Actual outcomes

Pending. Record each addition with its consuming visual slice, commit, focused
evidence, independent review, and final browser comparison in the adoption log.
