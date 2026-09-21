# App navigation

The Shell adopts the approved NavigationBar specimen under Vela Current. The
stable UI component owns responsive rendering; the app owns route links,
selected rig, remembered target-query context, and the read-only navigation
projection. Rig switching opens Observe and never connects or commands a rig.

`useNavigation` polls `/api/web/navigation` once per second after each completed
read. The endpoint uses catalog identities and existing capture-controller
snapshots, with no camera/rig inventory reads or saved-image scans. Capture's
page controller and commands remain independently owned by the capture feature.

The bar follows its current active rig across routes. Another active rig is a
catalog-order fallback; the summary always keeps the owning rig's identity.
Chris's current workflow is one operating rig, so this is not a multi-activity
control panel. Saved images stays in page context. Current exposure progress
is server-reported elapsed time, never a client clock or total-run percentage.
Only exposing shows timed progress. Reading/saving/stopping name their phase;
failed state links to Capture for the outcome.

Interrupted camera reads keep the run and count visible as Awaiting camera, with
no timed progress. This is distinct from lost server updates or tracking lost;
`captureReadState: 'current'` returns to the supplied phase, not completion.

Failed or malformed navigation reads preserve the last count and hide progress.
If an active controller disappears or returns idle, the bar reports tracking
lost instead of claiming completion. A confirmed stopped/complete snapshot
clears the activity. A failed outcome remains visible until superseded. No
capture state is persisted as a resumable workflow.
