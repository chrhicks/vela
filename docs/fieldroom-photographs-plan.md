# Fieldroom Photographs

Historical initial slice: accepted at `99195ae` after independent OK and the parent’s final visual comparison. Explore/framing/preparation passed independent OK and its final visual comparison at `8906518`; acceptance is recorded in `0f23355`. Photographs has now passed its implementation gate.

## Current adoption: Nights and Targets

On October 1, Chris approved the `photograph-library` workshop proposal and
requested production adoption. This supersedes the dated-list layout, automatic
newest selection and six-row disclosure described in the historical plan below.
The accepted flow is Nights / Targets → group with complementary filter →
selected photograph with return and Newer/Older navigation. Search and navigation
context belong in the URL; existing image deep links remain authoritative.

The browser groups immutable capture timestamps from noon to the following noon
in the server-projected IANA timezone. Vela currently has no observatory timezone
setting: both collection and detail provide the server's runtime zone, which is
explicitly labeled Vela server time and used consistently on every browser.
Target groups use recorded subject identity, with No recorded target for legacy
or unassigned captures. No sessions, metadata rewriting, tagging or new archive
storage are introduced. Existing inspection, failure handling and exact original
and display downloads remain intact. Server collection reads still return all
metadata and do not render thumbnails on demand.

The live approved specimen is the visual authority for this revision. The owning
[Photographs README](../apps/web/src/features/photographs/README.md) describes the
current route and state boundaries. [Library visual evidence](visual-evidence/fieldroom/photograph-library/README.md) records the comparison; current independent verification and Chris’s implementation acceptance are tracked in PR #86.

## Historical initial composition

## Outcome and boundary

Replace the separate saved-image grid and detail page with one Photographs composition: a dated selectable list, the selected photograph, and its exposure facts/downloads. Preserve both existing URLs, actual retained artifacts, disconnected-rig access, preview-version behavior, and the already implemented native inspection interactions. The camera does not have to be available to browse its saved photographs.

This slice adds no deletion, tagging, search, run history, archive conversion, gallery database, background collection polling, or server pagination. The current retained-image HTTP contracts are sufficient. The collection remains per rig.

## Sources inspected

- Frozen references: `docs/visual-reference/fieldroom/app/03-4.png`, `03-14.png`, `03-17.png`; manifest and coverage map beside them.
- Paper file `01M3SATFK7ZW5ZCBPFSWD6XS91`, page `p-1-0`: `O3-0` (03.4 Photographs), `1DN-0` (03.14 edge states), `1J6-0` (03.17 inspection). Read via tree summary, inline-style JSX, and computed styles. Paper token content hash reported `811c9dc5`. The full 03.4 JSX read for this draft is saved at `/tmp/vela-photographs-03-4.jsx`.
- Current `apps/web/src/routes/saved-images.tsx` and `saved-images.css`; `LatestImage.tsx`, `latest-image.css`, `useNativeImage.ts`; capture validation and model contracts; route registration in `main.tsx`.
- `apps/server/src/saved-images/{README.md,routes.ts,store.ts}` and the retained-preview contract.
- Current saved collection/detail coverage in `apps/web/tests/capture.e2e.ts`, retained-preview server tests, and `apps/web/tests/image-inspection.e2e.ts`.

03.14 and 03.17 are state/interaction sheets, not alternate full Photographs routes. Reuse their relevant state treatment and invariants without reproducing the sheet headings, unrelated equipment/framing cards, sample captions, or demonstration image crops in production.

## Desktop source geometry — 03.4

At 1440×900, use the existing approved 88px navigation and 36px page sides. The source has no separate back-link row above Photographs and no generic padded Panel enclosing exposure details.

| Region | Source node | Exact declared geometry and type |
| --- | --- | --- |
| Page heading | `OI-0` / `OJ-0` | 26px top, 24px bottom, 36px sides. Heading and rig/count share a baseline with 24px gap. Heading Space Grotesk 28/34; rig/count and availability note Barlow 14/20. |
| Main body | `OO-0` | Starts at y=172. 260px list, 736px viewer, 324px details; 24px gaps. Body height 644px in the reference. Column x positions 36, 320, 1080. |
| List | `OP-0` | 260px wide, 10px vertical gaps. Day / Newest first header Barlow 14/20, 4px bottom padding. Six initial rows. |
| List row | `OX-0`, peers | 260×85, 10px padding, 14px inner gaps, 6px radius, 1px border. Thumbnail 64×62, radius 2px, cover treatment. Copy column 126px with 8px gap. Time 16/24 (selected 500 weight); exposure/color 14/20. Selected arrow reserves 12px. |
| Selected row | `OX-0` | Active surface and control border; unselected rows use canvas and ordinary divider. Use semantic Fieldroom tokens, not hard-coded light colors. Mark the selected link accessibly. |
| Earlier control | `Q3-0` | Full-list-width neutral button, 46px high, 18px inline padding, 15/20 text. Copy derives from the number that the next reveal will show. |
| Viewer | `OQ-0` | 736px wide; reference outer height 644px; 6px radius, 1px divider, inset surface surround. No dark/black photographic well. |
| Viewer toolbar | `Q6-0` | 54px high, 18px sides. Left is captured date/time, e.g. `30 Sep · 21:39:08`, Barlow 14/20. Right: Fit/100% 46px, ↗ 44×44, 8px gaps. Active fill and both outlined buttons follow the accepted controls. |
| Image viewport | `QE-0` | 532px high at the reference width, full available width, centered uncropped fitted bytes. Actual source JPEG aspect ratio determines the side surround. |
| Viewer footer | `QH-0` | One row, 16px block / 18px inline padding, 14/20 secondary text, left caption and right collection position. It is not Tonight's two-row 70px acquisition metadata. |
| Details column | `OR-0` | 324px, 20px between groups. `Exposure details` Space Grotesk 24/30; secondary `Saved on this Vela server` 14/20; 8px heading gap, 16px bottom inset and divider. |
| Each fact | `QP-0` and peers | Label 14/20 secondary; value 16/24 primary; 7px gap. Captured, Camera, Exposure, Dimensions, Stars · HFR. |
| Downloads | `R9-0` | Top divider, 16px top inset, 10px gaps. Full-width 46px links: accent `Download original FITS ↓`, neutral `Download display PNG ↓`; help text 14/20. |
| Page footer | `RG-0` | 24px block / 36px inline padding, 14/20 secondary text. Keep the per-rig explanation; omit production design-study/sample claims. |

Two source details should be measured, not silently normalized: the six-row list plus its header, seven 10px gaps, and final 46px button totals 650px, extending 6px beyond the declared 644px body. The viewer's declared toolbar/image/footer content plus borders totals 640px inside a 644px stretched card, leaving small end slack. Preserve the reference geometry at 1440 and avoid clipping functional content. Do not invent a 56px footer solely to make the arithmetic fit; compare the actual render to the frozen image.

The page's source `height:900` / `overflow:clip` are artboard constraints, not instructions to hide real longer collections, error messages, or translated/wrapped values.

## Routes, selection, and bounded earlier disclosure

Keep these URLs working:

- `/rigs/:rigId/observe/saved-images`
- `/rigs/:rigId/observe/saved-images/:imageId`

Both render the same three-column composition on desktop. Remove the whole-page key containing `imageId`; key the collection owner only by rig. Selection changes should not clear the fetched list, reveal count, or list scroll position. A deliberately selected different photograph can reset its own inspection to Fit; palette changes and enlargement must not reset it.

Proposed initial-selection rule: a collection URL selects the newest returned image and replaces the URL with that image's existing deep link, once. An explicit deep link is always authoritative and never silently falls back to a different image after a 404. Use links for rows so open-in-new-tab and browser history work. Back/Forward changes the selected identity through the URL while retaining list state within the rig. A rig change clears selection and returns to that rig's collection URL; never carry an image ID into another rig.

The API already sorts newest-first by captured time and then saved time. Preserve that order rather than replacing it with a browser sort that discards its tie-breaker. Group by local captured date, with a label for each shown date; do not infer an observing session, capture run, or target group. Use 24-hour times consistently with the accepted Fieldroom clock treatment. The source's `Image 12 of 12` is a chronological position in this returned collection: `total - newestFirstIndex`, not a recorded capture-run exposure number. Suppress the position if a selected detail is valid but its collection is unavailable or lacks that ID.

Begin with six rows. `Show N earlier images` reveals `min(6, hiddenCount)` additional rows on an explicit click, retains the selected photograph/native viewport, and remains available until the known list is exhausted. No automatic infinite scroll, native-image prefetch, or per-row detail GET. Thumbnails use `fitImageUrl ?? imageUrl` and lazy loading. Keep the six-row first-view geometry; beyond it the list can scroll without pushing the inspected image out of place. Keep the earlier control reachable by keyboard and move focus predictably when the last reveal removes that control.

This is bounded disclosure per user action, **not server pagination or a hard bound on total metadata**: the current list endpoint returns the complete collection. Do not claim otherwise. On an older direct deep link, reveal enough of the list to expose and scroll to the selected row, while loading only visible thumbnails; this is explicit navigation rather than background archive work. If an actual large-archive case makes this expensive, stop and discuss a separate server-paging need rather than introducing a pagination framework into this visual slice.

No automatic collection polling is necessary for this scope. Opening the collection fetches current retained facts. If an explicit collection retry/refresh discovers newer images, preserve the current selected ID rather than choosing the new first item. New captures continue independently.

## Existing data contracts and ownership

The existing model already provides the required data:

- `SavedImagesView`: rig ID/name and `SavedImage[]`.
- `SavedImageView`: rig ID/name plus the selected `SavedImage`.
- `SavedImage`: immutable image/acquisition facts, `savedAt`, original `fitsUrl`, matching `previewDownloadUrl`, optional subject intent, and `previewRendering` (`current`, `legacy`, `unavailable`; absent legacy metadata is valid).

Continue validation with `isSavedImagesView` / `isSavedImageView`, including matching rig/selected identity and version-consistent same-origin file URLs. Never construct download URLs from a displayed label or manually substitute versions.

The browser owns collection selection, grouped presentation, bounded disclosure and independent collection/detail read state. Keep `GET web/rigs/:rigId/saved-images` separate from `GET .../saved-images/:imageId`; this permits a valid direct-linked detail to remain usable when the list fails. Preserve cancellation and the longer selected-detail timeout (120s vs collection 10s): detail opening may prepare a retained display derivative. A stale response for A must not replace B after selection changes.

The server owns artifact availability and rendering status. Its list GET only reads published metadata; selected detail calls `refreshPreview`. The file store already shares per-image work and serializes conversion. Do not call detail for all six thumbnails, regenerate the archive from collection loading, change retention originals, or start hardware reads/commands from the gallery. Shell rig telemetry may fail independently without blocking collection/detail HTTP reads.

Use the selected detail response as the authority for the preview treatment and downloads. A refreshed detail may update the matching list item's preview metadata by ID; unrelated rows stay unchanged. Collection legacy metadata is not proof that the selected detail still uses the original treatment.

### Identity publication

Image ID alone is insufficient for a retained preview: the same saved image can move from legacy `/preview` to `/previews/background-v1/preview`. Treat image ID **and the declared fitted/native URLs** as the pixel-resource identity. Visible pixels, display treatment labels, and PNG download must refer to the same identity/version.

The simplest selection flow is to keep the list visible, clear the selected viewer/details together for a different requested image, show a named loading state, and publish the validated selected metadata with only its own preview-loading placeholder/pixels. This avoids presenting A's pixels under B's facts or downloads. Do not keep an old image invisibly under a new header. When refreshing the same selected image's renderer version, either keep the complete old pixels/facts/download tuple until the new fitted pixels decode, or clear that tuple before the new version is published. Prefer the former only if the shared inspection controller makes it explicit; do not add a second reconciliation engine.

Actual production caption should name the saved display context (e.g. `Saved exposure · Display preview`, or `Original preview` when appropriate). The reference's `Reference image · Mock saved exposure` belongs only to deterministic review data. Optional chosen-subject metadata remains intent, not proof of pointing; do not invent subject-led grouping or copy a current target choice onto an older saved image. Preserve estimated-start wording on captured facts and retain absent legacy subject/source fields.

## Small shared image-inspection boundary

Photographs must not simply turn on `LatestImage.fieldroom` and hide pieces with CSS. That component currently owns Tonight's heading, receipt age/interruption anatomy, camera caption, acquisition row, Keep, live follow/hold messaging, and camera-cache expiry wording. Photographs needs different chrome and explicit selection. Framing will need inspection without pretending to have capture-retention facts.

Extract the already proved mechanics into a small browser-local boundary near the current image viewer. Proposed pixel contract:

```ts
interface ImagePixels {
  id: string
  imageUrl: string
  fitImageUrl?: string
  width: number
  height: number
}
```

A narrow `useImageInspection<T extends ImagePixels>` can retain the complete owner-supplied typed snapshot `T` atomically with decoded pixels, fitted/native mode, native-read outcome, held identity, and pan center. `CaptureImage` and `SavedImage` structurally satisfy this contract. A framing preview can supply its real fitted/native URLs, dimensions, acquisition facts and nullable checked-solution ID, or map them at a small UI adapter. It must not fabricate `saved`, statistics, camera metadata, or Keep capability; do not make every `CaptureImage` field optional.

Extract one controlled viewport and one enlargement/portal implementation. Keep the accepted pointer/touch/keyboard panning, fitted fallback during native decode, exact-resource retries, fitted queue bound, pan-center preservation, focus return, nearest-theme portal, background inert restoration, and body-scroll cleanup. Owners provide their heading/caption/footer and accessible image description. This is reusable image inspection, not an astronomy overlay renderer, plugin registry, general image-processing subsystem, or second state machine per presentation.

Keep decisions at the feature boundary:

- **Capture:** follows new frames until inspection holds; retains exact-image Keep and its independent outcome; owns Show latest and camera-cache expiry copy.
- **Photographs:** selected saved identity comes from the route; no Keep or live Show latest controls. A deliberate row selection resets the selected viewer to Fit. A narrow selected-view key can do this without remounting the collection. Enlargement, theme changes and Show earlier preserve selection/scale/pan.
- **Framing later:** new checked-exposure identity and nullable solve association are supplied by its own capability. The generic viewport knows neither alignment geometry nor solve validity and issues no hardware command.

The generic native reader should report a missing/failed exact resource, not hard-code `expired camera cache`. Saved native-preview 404 is not evidence that an unsaved capture expired or that original FITS is gone. Feature owners turn the generic read result into appropriate copy/actions. Preserve the exported `useLoadedImage` / `CameraMark` compatibility until their remaining consumers are deliberately migrated. Review the current loader's URL-directory scope assumption: it works for capture URLs but saved image/version directories differ, so scope/reset semantics must be explicit rather than accidentally inferred as another rig.

Do not duplicate the existing roughly 300-line Fieldroom viewport behavior. Some small toolbar JSX duplication between owner-specific compositions is preferable to dozens of boolean presentation flags. Keep the shared mechanism narrow enough that each feature's successful path still reads directly.

## Reachable states

| Condition | Required Photographs behavior |
| --- | --- |
| Initial list load | Named collection loading state, no fabricated count or placeholder capture facts. |
| Empty collection | Calm empty state explaining Save frames / Keep, with Tonight link. No arbitrary selected image or disabled fake rows. |
| Collection GET fails | Local collection error and explicit same-GET retry. A successfully loaded explicit detail remains usable. |
| Selected detail is preparing | Keep collection/selection visible. Explain that the display preview may take a moment; do not claim refreshed treatment is ready. |
| Detail GET 404 | Explain that this selected image or rig was not found. Preserve the deep link, list and ability to select another row; never substitute the latest image. |
| Detail GET 503/timeout | Local retry for the exact selected detail; no camera command, no gallery-wide reset. |
| Fitted or native PNG GET fails | Keep any matching already loaded pixels and facts together. Native failure retains fitted view and exact GET retry. If no pixels exist, use a truthful preview-unavailable placeholder; metadata/original FITS may still be usable. |
| `previewRendering.status === unavailable` | Show the original preview and matching original PNG link, clearly distinguish failed display refresh from the preserved FITS. Apply the relevant 03.14 fallback treatment. |
| Legacy collection entry | Original-preview label until opened; never eagerly regenerate all rows. Missing legacy fields remain accepted. |
| Zero stars / no measurement | `0 stars` is measured; unavailable statistics are explicitly unavailable. Null HFR is not zero. |
| Rig/device disconnects | Gallery remains available from server storage; no camera-ready gating. Shell connection status stays honest independently. |
| Appearance changes while inspecting | Same selected URL, same loaded frame/version, same mode/pan, same details and pending reads. |

03.14's saved-preview fallback is node `1F9-0`: inset surface, 1px divider, 6px radius, 24px padding, 14px groups; uppercase context 12/16 with 1.2px tracking, title Space Grotesk 24/30, message Barlow 16/24, and a neutral 46px FITS action. Its 672×290 rectangle is the state-sheet grid size, not a mandatory gallery-column size. Adapt this notice in the Photographs detail region while retaining the original pixels; verify that composition in the workshop. Keep one clear original-FITS action rather than scattering duplicate download controls. The normal three-column layout stays uncluttered.

Download links retain browser-native download behavior. Do not introduce whole-file Blob downloads merely to display a success message, particularly for FITS. A click is a requested download, not confirmation that the file was saved on the user's disk. The original FITS route remains immutable; the display PNG link must follow the exact displayed renderer version.

## Responsive and theme work

03.4 provides the approved desktop composition; it does not provide a dedicated Photographs phone board. Do not claim a phone layout is already pixel-approved. Use workshop evaluation for the compact selection flow before adoption.

Proposed compact behavior: retain a single responsive route and URL selection. Put selected preview and usable inspection controls first, exposure details/downloads next, then the dated list with a visible current-selection indicator and a jump to photographs control when needed. A collection URL with no selected data can show the list first during initial choice. Avoid placing six 85px rows above a selected image on a phone. At intermediate widths, use list + viewer with details below the viewer; switch to one column when the three source columns no longer have useful width. Exact breakpoints should follow rendered content, not device names.

Keep 46px text buttons, 44px icon controls, bounded touch panning, and wrapping metadata. Preserve focus when a responsive composition moves content; avoid separate desktop/mobile viewer mounts. Never crop the fitted image to fill a phone card or let native panning move the whole page. The shared enlargement overlay must still cover the viewport when the page/list is scrolled.

Use the accepted semantic palette for both modes: canvas, surface surround, active selection, ordinary/control borders, text, focus, and action colors. Image bytes and geometry stay the same. Do not recolor or filter astronomical pixels for dark mode. Compare dark behavior using the accepted token system; there is no separate frozen dark Photographs composition among these three source boards.

## Implementation order after the Explore/framing/preparation gate

1. Record this slice's agreed selection/disclosure/compact decisions and source geometry at the owning Photographs plan. Evaluate compact and fallback compositions in the workshop, without reopening established native-inspection behavior.
2. Extract the narrow inspection mechanism while preserving Tonight's current composition and tests. Do not fold Photos layout assumptions into Tonight or framing assumptions into capture contracts.
3. Introduce independent collection/detail reads and a rig-stable page owner; retain existing paths and browser navigation. Implement row selection, six-at-a-time earlier disclosure, and atomic resource/version transitions.
4. Compose the source three columns with real retained metadata, actual preview/file URLs, contextual fallback, and owner-specific image chrome. Remove displaced saved-grid/Panel layout and route-level `capture.css` coupling rather than accumulating overrides.
5. Add deterministic Photographs scenes to the existing development-only review registry/runtime: current/legacy/fallback, empty, selected missing, list failure with direct detail success, long preparation, fit/native failure, many dates, and direct link to an older revealed item. Reference imagery stays labeled fixture data and uses the frozen local bytes.
6. Run focused checks, prepare a clean review head, obtain independent OK, then perform the parent’s explicit comparison of the actual reachable gallery
   against Paper, under Chris’s intermediate self-acceptance authorization.
   Chris accepts the final whole-application experience. Update owning READMEs/adoption evidence only with actual outcomes. No merge or later slice before the governing gate.

## Focused proof and evidence

- Real-route list + detail: initial latest choice; explicit link; Back/Forward; selected highlight/date/ordinal; older deep link; Show earlier preserves selected native state and causes no per-row detail refresh; rig change clears foreign image ID.
- A slow detail A, then B, then A's late response: only B is published. Repeat with image decoding and renderer-version change to prove pixels, metadata and PNG downloads never cross identities.
- Direct detail succeeds while collection fails; offline camera does not block saved reads; source collection test's no capture-read assertion remains meaningful while allowing independent shell telemetry.
- Legacy preview refresh pending, current version success, and unavailable fallback; same-version fitted/native/download URLs; original FITS unchanged. Reuse existing server retained-preview tests unless the boundary actually changes; no server change is required by this plan.
- Native failed GET retains matching fit; missing saved native GET uses saved-preview wording rather than camera-cache expiry; retry never opens a different image. Original download stays available when only display refresh fails.
- Reuse the current image inspection browser suite for capture holding, Keep races, panning, theme retention, portal coverage/inert cleanup and focus return. Add saved-selection-specific assertions rather than duplicating every capture scenario.
- At 1440×900, record actual columns, 54px toolbar, 532px viewport, footer spacing, card/list extents, text metrics, source selected row and unchanged reference-image framing. Capture both palettes and relevant fallback states. Also inspect useful intermediate width and 390px phone content with no invented OS strip.
- Compare real screenshots with the frozen PNGs. Record content substitutions and the source's small list/card extent differences separately from implementation discrepancies. Browser acceptance is about the selected photograph and controls, not finding the runtime.

## Items for the parent to settle before execution

The source establishes desktop composition and inspection behavior. It does not settle the collection URL's default-selection canonicalization, the exact compact list/detail order, or how a 672px fallback state-sheet card fits the 324px detail column. The proposals above are deliberately small and should be confirmed in the slice/workshop alignment, not treated as already approved source pixels. Six-at-a-time reveal is a UI disclosure bound; it must not be represented as a server scalability feature.

## Execution decisions and current ownership

The parent settles the proposed newest-image canonical deep link and six-row
disclosure within the approved slice. Explicit selected links remain
authoritative; no missing-image fallback. Keep both current URLs, preferably
one optional-image route definition if needed to preserve the collection owner.
The collection owner is keyed only by rig; the selected viewer is keyed by image
and declared pixel URLs. A renderer-version replacement explicitly resets that
selected viewer to Fit with its matching metadata/placeholder. This chooses the
permitted clear-before-publication behavior and avoids a hidden held legacy
version without a gallery “Show latest” action.

The shell's rig selector keeps Photographs context only when already browsing
this collection: it opens the new rig's collection URL, dropping the selected
image identity. Other routes retain the established Tonight destination. This
narrow exception makes the source's “Select another rig to browse its
photographs” footer true without carrying a foreign image ID between rigs.

The planned extraction is already complete in
`apps/web/src/features/image-inspection/` from the preceding slice. Reuse its
generic `ImagePixels`, `useImageInspection`, native reader, `ImageViewport` and
`ImageEnlargement`; do not repeat the extraction or copy its interaction state.
Owner chrome may be small direct JSX. The existing shared viewport imports
capture CSS; move only common mechanism styles if required, preserving Tonight
and framing through their existing regressions. This is not permission to
restructure unrelated viewers.

Workshop evaluation owns a new non-exported product example and local specimen
CSS. It settles preview-first/details-next/list-last at phone width, an explicit
list jump and selected-row indicator, a useful middle-width arrangement, and
the fallback notice inside the detail column. Render both palettes and current/
fallback states before application composition. The parent accepts this
intermediate design under Chris's execution instruction.

Implementation ownership is bounded: route/composition and selected inspection
under `apps/web/src/routes/saved-images.*` and a small web-local Photographs
feature boundary if necessary; route registration in `main.tsx`; independent
fixture scenes under `apps/web/tests/fixtures/fieldroom/photographs.ts` with the
existing registry; gallery-specific real-route behavior checks in a new test
file, with existing capture gallery selectors updated only to equivalent
behavior. Parent owns this plan, adoption evidence and final integration. No
server or model change is planned.

Before review, verify cancellation and late A/B responses, direct detail during
list failure, six-row reveal/focus, URL history and rig changes, exact preview
version/download association, fit/native failures, compact layout and palette/
enlargement preservation. Then follow the same independent-OK and final visual
comparison gate. Planned versus actual results will be appended from evidence.

## Workshop evaluation actual

The non-exported `Panel.photographs.specimen.tsx` and colocated CSS reproduce
the source desktop columns and demonstrate compact selection/fallback behavior.
Thirteen workshop browser checks and the UI build passed. Parent inspection of
all twelve light/dark/current/fallback renders at 1440, 900 and 390px accepted
the three-column source composition, list+viewer/details middle layout, and
preview-first phone flow. The first phone pass used 18px outside insets; these
were corrected to the application's 20px compact spacing before acceptance.
All five affected phone/interaction checks passed and the parent inspected the
four corrected phone renders.

Native workshop inspection confirmed one viewer and one original-FITS action
in fallback. Jump to photographs focused the dated list heading; selecting a
different row updated its selected marker/caption and focused the viewer.
The final reveal removes its exhausted button and focuses the list heading.
Only those explicit actions move focus; initial rendering and theme changes do
not. The fallback notice grows naturally below the detail facts instead of
clipping inside the source's state-sheet rectangle. Its caption names the
original preview and its PNG action follows that treatment.

The specimen is a composition reference, not exported production behavior.
Its controls demonstrate scale/enlargement with explicit workshop feedback;
the real application reuses the already verified shared inspection mechanism.
The source-backed example is reachable at
`http://127.0.0.1:5174/?component=panel&specimen=fieldroom-photographs&profile=fieldroom&mode=light&context=isolated&viewport=1506&prop.preview=current`.
The workbench's 66px canvas surround means viewport parameters 1506/966/456
produce actual specimen widths 1440/900/390. Set `preview=unavailable` for the
fallback composition. Native snapshot export remains unavailable; deterministic
workshop PNGs provided the visual evidence.

Independent list/detail read hooks are implemented without camera dependencies.
The shared viewport and dialog styles were moved to their image-inspection owner
without changing geometry; all 29 existing image-inspection, preparation and
Tonight browser checks pass. Fifteen deterministic Photographs fixture scenes
cover the planned boundary states. Their download FITS is a clearly labeled
synthetic 1280×1224 zero-data artifact, not the original of the reference JPEG;
resource hashes and response schemas were checked. Preview fixture URLs serve
the pinned JPEG intentionally, and do not establish production PNG encoding.
Application integration passes 19 Photographs browser checks, two existing saved-image
regressions and four navigation checks. Repository lint and web/UI builds pass.
The gallery checks cover independent failures and retries, delayed selection,
renderer versions, earlier disclosure, history, rig changes, compact layout,
palette/native pan preservation and enlargement focus. Browser checks assert
matching download anchors; a separate actual HTTP GET through the review runtime
returned the synthetic FITS with the expected content type, 3,136,320 bytes and
pinned SHA-256. This does not claim an operating-system disk-write test.
Independent review and the final post-review visual comparison remain pending.

## Final verification and parent acceptance

Independent **OK** at `99195ae` found no issues: 876 project tests and all builds,
178 web checks, 22 workshop checks and four Python checks passed. After that
verdict the parent reran the 19 gallery checks and captured/inspected twelve
settled current/fallback renders in both palettes at 1440, 900 and 390px.
Desktop source geometry, image framing, list extents, compact order, fallback
wrapping, controls and typography match the source and evaluated specimen.
No application correction was required by that comparison.

[Retained evidence](visual-evidence/fieldroom/photographs/README.md) includes
the screenshots, geometry, reproduction recipe and factual substitutions.
Native snapshot/host limitations are distinguished from project browser evidence.
The parent accepts this intermediate slice under Chris’s authorization;
Equipment/Home/onboarding may proceed. Chris’s final whole-application browser
acceptance remains required before merge.

### Final whole-application state-sheet correction

The final coverage audit added a held archive-collection request. Its rendered
capture exposed a visual omission from source 03.9: initial collection loading
and the empty archive still used plain list text rather than the approved state
card. This is a presentation correction; list/detail ownership, navigation and
request timing remain unchanged. The completed-gallery and fallback composition
remain the accepted layouts above.

Plan before correction: extend the existing Photographs workshop specimen with
loading/empty collection examples, inspect both palettes at 1440 and 390px, then
adopt the approved card in the real route. Source `10N-0` specifies a 440×294
card, inset surface, 1px divider, 6px radius, 24px padding and 16px between its
three groups. Context is 12/16 with 1.2px tracking; title is 24/30; title/body gap
is 10px; body is 16/24 with a 72px minimum; action/loading footer is 46px high.
Use content growth on narrow screens rather than clipping. Initial unselected
collection state may span the absent viewer columns, max 440px; phone uses the
available 350px. Loading has no saved count or invented rig facts. Empty state
uses the confirmed rig name and the current Tonight link.

A direct selected photograph must stay usable while collection loading or failure
is displayed in the narrow list region. Do not replace its viewer, fetch other
images, or infer an empty archive from a pending request. Retain the existing
explicit loading text and empty heading semantics where compatible with the
source. Verify held loading→resolved collection, empty→Tonight navigation, and
direct-detail independence. Retain paired route captures after fresh independent
OK and the final source comparison.

The parent inspected the actual workshop loading/empty cards in light/dark at
1440/390px against 03.9 and approved the source anatomy. Eight new workshop checks
and 13 existing gallery/fallback checks passed. Production now uses a narrow
owning-route collection-state component; only an unselected collection spans the
vacant columns. A direct-linked photograph keeps its viewer and detail while the
loading card fits the existing 260px list column. No hook or API behavior changed.

Nine new route checks (eight paired matrix states plus direct-detail independence),
19 existing Photographs cases and nine final-state cases pass. Scoped lint and
web build pass. The direct-detail case preserves the same image DOM node and
checks that releasing collection loading causes no extra detail read. The parent
also corrected inherited text-rendering only on the new card to match the
workshop's exact Barlow wraps; populated-gallery typography is untouched.
Independent verification and final post-verdict comparison are next.


The collection-state addendum is accepted at `cd404b8` after independent **OK**
and the final post-verdict route comparison. All nine new collection captures
were inspected against source 03.9 and the approved workshop; both palettes,
desktop/phone wrapping and selected-detail independence match the agreed design.
The post-verdict collection/shared-state run passed 31 cases and the whole-route
reference run passed 46. [Final retained evidence](visual-evidence/fieldroom/final/README.md)
includes the nine captures and their hashes. Chris's whole-application acceptance
remains the merge gate.

## October 1 library workshop approval

Chris's live review reopened archive navigation: six-row disclosure makes finding
another observing night awkward. Nights and targets are equally useful starting
points for him. The separate `photograph-library` Panel specimen explores equal
Nights / Targets tabs, searchable group cards, a group's photograph grid, a
cross-filter (target within night or night within target), and selected-photo
inspection with newer/older navigation. Chris approved this design and authorized application adoption.

The specimen uses 64 invented records over four nights and repeated bundled
reference images. Its noon-to-noon local observing-night boundary is a presentation rule, not a
saved session or capture run. Production capture metadata is unchanged; the
collection/detail viewing contracts now explicitly provide Vela server time.
Unknown subjects stay visible as No recorded target rather than being inferred
from the pixels. Real archive paging and retained-image rendering remain separate
boundary concerns; this prototype does not change either server behavior.

Open `http://127.0.0.1:5174/?component=panel&specimen=photograph-library&profile=fieldroom&mode=light&context=isolated&viewport=1280`.
