# Photographs

The per-rig `/observe/saved-images/:imageId?` route owns the photograph library
and selected image. The collection entry opens equally prominent Nights and
Targets tabs. It does not select an image automatically. Group cards summarize
retained images, and a group opens a thumbnail grid with a complementary target
or night filter. Search matches group dates and recorded target names/catalogs.

`browse`, `group`, `filter` and `q` query parameters retain that browsing context
across selection, reload and Back/Forward. Image IDs remain in the existing detail
path. An explicit detail remains authoritative even when its collection fails,
is empty or omits that image; never silently substitute another photograph.
A direct image link without group context derives its observing-night breadcrumb
when available. An invalid group has an explicit unavailable state and a return
link. Switching rigs opens the other rig's library without carrying image or
group identity across rigs.

`library.ts` groups the server-ordered metadata without changing order within a
group. An observing night begins at noon in the response's `timeZone` and ends
at the following noon. Calendar-date arithmetic preserves this boundary across
DST. All capture times, grouping and labels use that server-provided zone; the
footer identifies it as Vela server time. A phone's timezone does not alter the
library. These are derived groups, not saved observing sessions or capture runs.
Targets use recorded subject IDs, not display names or solved pointing. Null or
absent legacy subject metadata remains under No recorded target.

The endpoint still returns the complete collection. Grouping, search and filters
are browser presentation, not server pagination. Thumbnails load lazily, with
no per-thumbnail detail reads or archive preview conversion. There is no
six-at-a-time disclosure, automatic collection polling or new archive database.

`useSavedImages` reads collection metadata independently from `useSavedImage`.
Their timeouts remain 10 seconds and 120 seconds respectively; opening detail
may prepare a retained display derivative. Both cancel obsolete requests and
validate rig/image identity and the viewing timezone at the HTTP boundary.
A failed list or disconnected camera does not block a valid direct detail.
Retries are explicit reads, with no capture/device request. A collection retry
preserves selected pixels and inspection state.

`SelectedPhotograph` uses the existing image-inspection controller, viewport and
enlargement. Its key includes acquisition ID and fitted/native URLs, so a new
selection or renderer version clears the old viewer before publication. Facts,
rendering copy and downloads come from the displayed typed snapshot. Valid
metadata and original FITS remain accessible when preview pixels fail. Native
404/410 is a missing saved preview, never evidence of camera-cache expiry or
loss of the retained original. Downloads use validated exact resource links.

Newer/Older navigate within the selected group/filter, keeping the URL context.
The ordinal is newest-first within that displayed group, not a capture-run
counter. Suppress navigation/ordinal if collection membership is unknown.
Desktop inspection pairs the image with exposure facts; phone inspection stacks
them. Explicit navigation moves focus to the opened group or image; initial
rendering and appearance changes do not. Returning to a group preserves filters.
Enlargement preserves inline extent and shared native pan/focus behavior.

The accepted library composition is
`packages/ui/src/drafts/Panel.photograph-library.specimen.tsx`; the application
composes stable primitives and does not import that product specimen. The older
`Panel.photographs.specimen.tsx` remains historical design evidence for the
previous dated-list composition. Existing loading/empty and retained-preview
fallback treatments continue to apply. The adoption plan and retained-image
server README own visual evidence and artifact/version contracts respectively.
