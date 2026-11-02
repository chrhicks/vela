# Read-only model view

`/rigs/:rigId/model` shows the local Aim model and the separate shadow service.
The page reads `/api/web/rigs/:rigId/model` every five seconds after the previous
request finishes. Hidden tabs cancel their read and stop polling. One snapshot
replaces the previous snapshot. Each source contains at most 30 fixes, plus total
fix, rejected-join and skipped-frame counts. The chart orders fixes by exposure
midpoint. It spaces frames equally, rather than implying a uniform time interval.

The web route never connects to equipment or sends commands. Its shell omits rig
inspection, rig controls and alert actions. Failed reads retain the last snapshot
with an unavailable label and its read time. A 503 with no prior snapshot shows
both sources as unavailable.

The server reads shadow data from `VELA_SHADOW_MODEL_STATE_DIR`. Compose mounts
the model service's existing state directory read-only at `/data/model`, over the
writable parent data mount. Create that host directory before starting compose,
as required by the model service. Native server runs leave the variable unset
until the shadow checkpoint directory is available.

This adds no listener or broker permission. The reader uses the existing
checkpoint loader and calls no save method. An absent or invalid checkpoint,
missing rig, read failure, or checkpoint older than 15 seconds displays
"Shadow service not running / no data". A stale valid checkpoint remains visible
as last known. Checkpoint freshness is evidence of recent consumption, not a
process liveness probe. A quiet fact stream also stops checkpoint updates.
The local Aim assessment API remains unchanged.

The API test uses the real reducer, checkpoint writer and HTTP route with a
synthetic rig. Browser tests use a synthetic `fake-rig` response. Neither check
opens a camera, moves a mount, or contacts Cria. Run the browser check with
`pnpm --filter @vela/web test:browser tests/model.e2e.ts`. Set `MODEL_SCREENSHOT`
to an absolute PNG path to capture the populated page.
