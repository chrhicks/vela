# Running Vela in Docker

Two application containers from this repo: `server` (the API) and `web` (nginx serving the built
app and proxying `/api` to the server). `web` is published on the LAN. The NATS
broker publishes only on loopback. The server port stays inside the compose network.

**There is no login.** Whoever can reach `VELA_PORT` can drive the rig. By choice it is
LAN-wide, the same as `pnpm dev:observing` on port 5173.

## Layout on the host

Config and data live in XDG directories, mounted into the containers (override with
`VELA_CONFIG_DIR` / `VELA_DATA_DIR`):

| Host | In the container | What |
|---|---|---|
| `~/.config/vela/cria.json` | `/config/cria.json` (read-only) | Cria rigs; required, `{"rigs": []}` is the minimum |
| `~/.config/vela/alerts.json` | `/config/alerts.json` (read-only) | Pushover keys and alert thresholds; optional, see below |
| `~/.local/share/vela/rigs.yaml` | `/data/rigs.yaml` | rig catalog, written by Vela |
| `~/.local/share/vela/saved-images/` | `/data/saved-images` | captured frames |
| `~/.local/share/vela/survey-cache/`, `traces/`, `run-log/`, `alignment-diagnostics/` | `/data/...` | caches, trace journal, [run log](run-log.md), evidence bundles |
| `~/.local/share/vela/astap/` | `/astap` (read-only) | `astap_cli` and `catalog/opt/astap/` (D05 star database) |

The server image runs with `NODE_OPTIONS=--conditions=built` (set in `compose.yaml`). It makes
`@vela/rig-events` load from its built `dist/`, because Node does not run TypeScript source from
`node_modules`. Anything else that starts `node dist/server.js` needs the same flag; `pnpm start` has it.

The ASTAP binary and star catalog are not in git; copy them into `astap/`. Create the
directories as the user that runs the stack: the containers run as `VELA_UID:VELA_GID`
(default 1000:1000) so the files stay yours.

### Phone alerts

Without `alerts.json` alerts show in Vela only, and the alerts API says phone alerts are not
configured. To send them to Pushover, create the file with the script, which prompts for the
application token and user key without echoing them and writes the file with mode 600:

```sh
scripts/set-pushover-keys.sh
docker compose restart server
```

Never paste the keys into chat, a commit or a log. The file may also set any number the alert
rules use under `"thresholds"`; see `apps/server/src/alerts/thresholds.ts` for the names and
defaults. Unknown keys are refused at start. `GET /api/web/rigs/<rig>/alerts` shows the thresholds in
use, and `POST /api/rigs/<rig>/alerts/test` (an empty JSON object) sends a test message.

The Cria URL in `cria.json` must be reachable from the host; containers use the host's
routes, so a Tailscale address works if the host is on the tailnet.

## Run

```sh
# Complete the broker provisioning below before the first full stack start.
docker compose up -d --build     # http://<host>:5173, or VELA_PORT=...
docker compose logs -f server
```

Update: `git pull && docker compose up -d --build`. The containers restart
automatically (`unless-stopped`). The image build runs `pnpm install` and `pnpm build`
inside Docker. Manual broker provisioning needs the tools listed below. The install downloads
`@cria/primitives` and `@cria/wire` from GitHub at the commit pinned in
`pnpm-workspace.yaml`, with no credentials.

## Moving from `vela-observing` on another machine

Only one Vela may talk to a Cria at a time. With no capture running:

1. Stop the old one (`systemctl --user stop vela-observing`).
2. Copy `rigs.yaml`, `saved-images/`, `survey-cache/`, `traces/` and the ASTAP files into
   the data directory, and `cria.json` into the config directory (`rsync -a`).
3. `docker compose up -d --build`, then open the app and check the rig shows its devices.

To roll back, stop the stack and start the old unit again; its data is untouched.

## Provision the rig event broker

The official NATS image is pinned to 2.15.2 and its registry digest in `compose.yaml`.
The broker stores JetStream files in `$VELA_DATA_DIR/nats/jetstream` (by default,
`$XDG_DATA_HOME/vela/nats/jetstream`, or `$HOME/.local/share/vela/nats/jetstream`).
It runs as `VELA_UID:VELA_GID`, like the server.

Provision by hand from the checkout. Use Node 22.18 or newer, the workspace
dependencies (`pnpm install --frozen-lockfile`), Python 3.11 or newer, and `uv`.
The scripts pin the official `nats-py` client to 2.16.0 without changing the
application dependency graph.

```sh
uv run --script tools/nats/provision.py init
mkdir -p "${VELA_DATA_DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/vela}/model"
docker compose up -d nats
uv run --script tools/nats/provision.py apply
```

`init` creates `$VELA_DATA_DIR/nats/credentials.json` and `server.conf`, both mode
0600 in a mode 0700 directory outside the checkout. It generates passwords once,
keeps them on repeat runs, and never prints them. Compose reads the generated
server configuration. Keep both files private. No password or site setting belongs
in `.env`, a command line, an issue, or a log. To select a different data directory,
set `VELA_DATA_DIR` for both compose and the tool, or pass `--data-dir` to the tool.

`apply` reconciles two bounded file streams and four durable pull consumers.
A repeat with the same registry and policy reports `0 resources changed`, preserving
messages, consumer positions, and credentials. Stream filters and data permissions
come from `packages/rig-events` through `tools/nats/policy.mjs`. Changes to the
registry require another `init`, recreation of the broker container so its bind
mount reads the new configuration, then `apply`. Do this outside an observing session.
Run provisioning commands one at a time.

The broker listens on port 4222 inside the compose network as `nats:4222`.
The host mapping is **127.0.0.1 only**, so LAN and tailnet peers have no direct
published endpoint. No monitoring, cluster, or leaf-node port is enabled.
Use an SSH tunnel over the tailnet for remote inspection. The provisioning tool
accepts only a loopback URL (`--url nats://127.0.0.1:PORT`).

Runtime connections use their role's password from the private file and set their
client inbox prefix to `_INBOX.<role>`. Give each service only its own credential.
The provisioner credential belongs only to the manual tool.

| Role | Data publication | Reading |
|---|---|---|
| publisher | Kinds whose registry producer is `vela` | Its publish acknowledgment inbox only |
| archiver | None | `archiver-v1` on both streams |
| solver | Kinds whose registry producer is `solver` | `solver-v1`, frame facts only |
| model | Kinds whose registry producer is `model` | `model-v1`, all facts |
| observer | None | Live assessment subjects only |

Each pull role may request consumer info, pull the named durable, and acknowledge
only that durable's messages. All roles receive replies only on their own inbox
prefix. Runtime roles cannot create or delete streams or consumers, purge streams,
fetch messages directly, or read another role's inbox. The registry's `operator`
and `cria` producers have no runtime credentials in this step.

Facts retain up to 20 GiB and assessments up to 2 GiB, both for at most 14 days.
Messages are limited to 1 MiB and duplicate message ids are suppressed for two
minutes. These are initial bounds, not an archive guarantee. Services added in
later steps bind the existing durables without creating them. Each durable has
explicit acknowledgments, a 30-second ack deadline, and at most 256 unacked messages.
The read-only observer is a live subscription, without a replay cursor.

To verify without the real compose project, set `TMPDIR` to a writable scratch
directory outside the checkout and run the check below. It creates a unique container
from the compose image on a random loopback port, tests every runtime role and real
pull acknowledgments, checks repeat provisioning, and removes its container and data.

```sh
uv run --script tools/nats/verify.py
```

The server publishes the run log to JetStream when both `VELA_NATS_URL` and
`VELA_NATS_CREDENTIALS_FILE` are set. Compose sets these to the internal broker
and `/data/nats/credentials.json`. The file is read once at startup; the server
uses only its `publisher` role. Without both variables the publisher is off.
`/api/health` reports `publisher` alongside `runLog`.

The publisher retains at most 128 envelopes or 5 MiB of encoded payloads,
whichever fills first. That is 128 snapshots at the step 12a estimate of 40 KiB,
about two minutes at one snapshot per second. A single in-flight publish can
retain another 1 MiB. Oversized messages are dropped. A full queue drops its
oldest event. After recovery, a `gap` per affected rig reports the dropped count
and the first and last lost observation times before the retained tail resumes.
The queue is volatile and shutdown does not flush it. JetStream uses each
envelope's id as `Nats-Msg-Id`.

Run `TMPDIR=/path/to/scratch uv run tools/nats/verify-publisher.py` to provision a
disposable broker, kill it during FakeCria capture, restart it and read the gap
and retained tail back. The check removes its container and private files.

## Archive the rig event stream

The `archiver` Compose service uses the server image with a separate entry point.
Its disk work and failures are independent of the capture server. It pulls the
existing `archiver-v1` durable consumer on both streams, using the `archiver`
password from the private credentials file. Errors contain no credential or event
payload. The service restarts on failure and resumes the durable consumers.

Before starting it, create `/mnt/storage/rig/archive/` owned by the configured
Compose UID and GID. The bind mount refuses to create a missing host directory.
`VELA_ARCHIVE_DIR` can select another host directory. This step adds the service
but does not deploy it or create the production archive.

Files have the layout `YYYY-MM-DD/<kind>/<batch-uuid>.jsonl`, using the envelope's
UTC event time. Each line is a canonical envelope. Batches contain at most 128
messages per stream. A writer fsyncs each temporary file, renames it to JSONL,
and fsyncs its directory and all newly created directory entries before it acks
any message in the batch. An I/O or decode error stops the process without an ack.
Incomplete `.tmp` files are ignored. They can remain after a crash.

Deduplication is **on read**, by event ID across the entire replay. A crash after
rename and before ack can leave repeated envelopes in separate files. The reader
returns each matching ID once, even after broker redelivery or a later republish.
Do not treat a raw concatenation of JSONL files as an exactly-once replay.

`createArchiveReader({ from, to, kinds })` in `@vela/rig-events` filters decoded
lines by an inclusive event-time range and optional kinds. Keep one instance per
replay. The filesystem adapter `readArchive(directory, range)` in
`apps/server/src/run-log/archive.ts` streams committed files through that reader.
Each new record has an additive `broker` field with its `stream` and `sequence`.
The adapter buffers matching records and returns broker stream/sequence order.
Legacy records without metadata keep their file order. Replay a stopped archive
for a stable snapshot. Corrupt committed JSONL fails the replay. Memory use grows
with the matching records and their unique IDs.

There is no archive retention or compaction in this step. At the run log's measured
rate of about 1.6 GB per day of `cria.state`, allow about 48 GB per 30 days, plus
other events, redeliveries, and filesystem overhead. A read-only check on the
implementation host found about 1.86 TB free on `/mnt/storage`, enough for this
step. Capacity still needs monitoring before long-term unattended use.

Run the crash check with a disposable broker and temporary archive only:

```sh
uv run tools/nats/verify-archiver.py
```

On the development host, this check requires Docker, a user systemd session, and
the shared `safe-kill` helper. When using the runner, pass `XDG_RUNTIME_DIR`
explicitly so the test scope can reach the user session.

It publishes to both streams, SIGKILLs an archiver PID after durable writes and
before ack, restarts it, and compares the reader's IDs with all published IDs.
It also checks that raw redeliveries occurred and that no credential reached the
child's output. It removes its container and temporary files. It does not contact
hardware or the live Compose project.

## Solve saved light frames in shadow

The `solver` service uses the server image with its own process. It pulls one
frame at a time from `solver-v1`, reads only saved light FITS, and publishes a
`solve-result` fact with the original frame event ID, raw ASTAP outcome, C1
verdict, measured scale and parity, position, and solve duration. Calibration
and unsuccessful capture records are acknowledged without a solve. Vela does
not consume these results or wait for the service.

Set `VELA_SOLVER_FIELD_HEIGHT_DEGREES` from the rig's configured optics before
starting the solver. It is the full image field height supplied to ASTAP, as in
backfill. No guessed default is supplied. ASTAP and its catalog, the private
credential file, and saved images have read-only mounts. The service uses only
the `solver` password. It has a one-CPU limit and a 1 GiB memory limit.

A solve uses the FITS J2000 `RA` and `DEC` as its search hint and claim when
present. Older images without those cards use an all-sky search and report the
hint check as unchecked. The star-count check is also unchecked because the
ASTAP adapter does not return a count. Alignment-trial frames use the alignment
purpose; other frames use framing. The configured field height and frame height
supply the expected scale, with parity +1, as in Vela's judged solver.

Only a confirmed JetStream result publish permits a light frame's ack. A solve
sends progress every ten seconds to extend the broker's thirty-second ack wait.
The worker holds one message locally; the durable has the broker's 256-message
unacked bound and the stream has the documented retention bounds. There is no
unbounded process queue. Broker or publish failure stops the service without
acking that frame. Compose restarts it. Redelivery has a stable result ID per
frame, solver version, and purpose. Archive readers deduplicate that ID even
outside JetStream's two-minute duplicate window.

After upgrading the image, rerun broker provisioning to add the new registry
subject to the stream and solver permissions. This change does not deploy it.

Run the recorded-data check with a disposable broker. All data paths are read
only and the check prints counts only. Select one UTC date of the old frame log
with saved lights, and the step 4 digest cache for those images.

```sh
TMPDIR=/path/to/scratch TEST_VELA_DATA=/path/to/vela-data \
  TEST_NIGHT=YYYY-MM-DD TEST_BACKFILL_CACHE=/path/to/backfill/solves \
  TEST_FIELD_HEIGHT=FIELD_HEIGHT_DEGREES uv run tools/nats/verify-solver.py
```

After a real night with Chris, read the archiver's `frame` and `solve-result`
facts using `readArchive`, with one reader for the entire night. For every saved
light frame ID, require one unique result whose `body.frameEventId` matches.
Check `body.verdict`, `body.solve.solveMs`, and `body.solve.centre` for the result.
Calibration frames must have no result. Compare the frame records' exposure
start intervals and settle times with the capture trace to check cadence. Also
check the publisher drop counter, gaps, and `solver-v1` pending and ack-pending
counts. Retention loss or missing results makes that check incomplete. The
recorded replay does not establish live capture cadence.

## Run the model in shadow

The `model` compose service uses the server image and the private `model` broker
credential. It pulls all facts from `model-v1` and publishes `mount-position` and
`pointing-fix` assessments. The server host remains the source of the model API.
The service has no equipment connection or command capability.

The service and archive replay share `createStreamModel`, which calls the same
`step` and `assess` exports as the server host. After each unique fact, a clock
input advances to that fact's `seenAt`. No wall clock enters replay. Accepted
`solve-result` events use the legacy solve join; rejected C1 verdicts cannot fix
pointing. Delivery order matters. Redeliveries at or below each stream's applied sequence are ignored.

The model keeps no input archive. It checkpoints every 128 deliveries or 2 seconds,
whichever comes first, before acknowledging that batch. This bounds unacknowledged
work below the consumer's 256-message limit and limits idle checkpoint delay.
A normal restart loads the checkpoint and resumes `model-v1` without archive reads.
If the checkpoint is missing, invalid, or behind the durable consumer's ack floor,
it rebuilds through that floor from step 37's read-only archive in broker order.
If the archive has not reached that floor, startup fails without acknowledging more facts.

Each rig has two fixed checkpoint slots, with a 16 MiB limit per slot, and a
shared atomic manifest containing stream sequence high-water marks. Temp writes,
file sync, rename, and directory sync commit a complete generation before ack.
A failed write can leave one temp file per rig, so storage is at most 48 MiB per
rig plus the manifest. Exceeding the limit stops consumption rather than dropping
reducer state. The private V8 checkpoint format is versioned with the reducer.
The reducer's session-scoped `decided` map is preserved unchanged.

Create the `model` data directory in the provisioning steps above before starting
compose. Its bind mount uses `create_host_path: false`. The archive mount is read-only.

Run the disposable-broker check with:

```sh
uv run tools/nats/verify-model.py
```

It runs the archiver and model against a disposable broker, restarts the model
before an acknowledgement, and compares live assessments with ordered replay.
It checks that broker redelivery converges and credentials stay out of output.

Compare a stopped archive over an inclusive event-time range with epoch-millisecond
bounds after building the server:

```sh
node --conditions=built apps/server/dist/rig-model/replay-main.js ARCHIVE FROM_MS TO_MS
```

The tool reads the whole archive to reconstruct prior state, then compares outputs
inside the requested range. It reports the first differing envelope and exits 1,
or prints `equal: true` with the assessment count. An archive missing prior facts
cannot establish equality for a live model that consumed them.
