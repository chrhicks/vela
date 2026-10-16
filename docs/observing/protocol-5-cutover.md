# Cut the FRA 400 over to Cria protocol 5

This checklist moves Vela on thuban onto the TypeScript Cria on errai, which speaks protocol 5. It then proves one short dark, one small focuser move and one cancelled slew. Chris drives the rig, and the observer works on errai. An agent does not drive any step.

Follow these rules at every step:

- Inspect the actual state before each step.
- Stop on any unexpected or uncertain result. Do not repeat a command whose outcome is unknown.
- Leave the rig in its observed starting state. Write down anything left changed.

## What changes in Vela

- Cria mode speaks protocol 5 only. A Vela older than this change cannot reach the TypeScript Cria.
- Vela matches the saved imaging camera to Cria by device ID. Cria still verifies the configured `expectedName` against the actual device. The saved camera in `rigs.yaml` (`fra-cria`, name `ZWO ASI2600MC Pro`, uniqueId `cria:fra-cria:primary`) keeps working, so you do not edit `rigs.yaml`.
- Vela updates the saved `fra-cria` endpoint in `rigs.yaml` itself when it starts with the new URL in `cria.json`.
- When an operation ends `uncertain`, Cria holds the device's failure domain until a person recovers it. Vela refuses rig operations while a hold exists, and it shows the hold's reason on **Your rig** and on the capture page.
- Vela has no **Recover** button yet. A temporary route, `POST /api/rigs/:rigId/devices/:deviceId/recover`, clears a hold. [Recover a held device](#recover-a-held-device) shows the call.
- Physical polar alignment on this AM5 remains unavailable. Preparation requires an advertised sweep rate near the existing 1°/s rate and refuses before homing or moving when none exists. The AM5's 8x rate (0.2507°/s) needs about 228 s per baseline leg, beyond the pinned Cria's 120 s rotation limit. Its 9x rate (3.008°/s) has stop error that can exceed Vela's 54–60° corridor. This session checks capture, autofocus and slew cancellation. Qualifying the physical baseline is deferred.

## 0. Check the preconditions

1. Confirm that the change that adds this checklist is merged on Vela `main`.
2. Confirm with the observer that Cria on errai listens on `100.104.187.54:4319` and has `commandsEnabled: false`.
3. Confirm that no other Vela is operating errai, such as a dev server in a worktree.
4. From thuban, read Cria's state:

   ```sh
   curl -s http://100.104.187.54:4319/v2/state | jq '{protocolVersion, commandsEnabled, devices: [.devices[] | {id, name, reason: .availability.reason, held: .quarantine.held}], open: ([.operations[] | select(.state != "settled")] | length)}'
   ```

   Continue only if the output shows all of these:

   - `protocolVersion: 5` and `commandsEnabled: false`.
   - Six devices: `primary` (`ZWO CCD ASI2600MC Pro`), `guide` (`ZWO CCD ASI220MM Mini`), `focuser` (`ZWO EAF`), `mount` (`ZWO AM5`), `weather` (`Pegasus PPBA`) and `switch` (`Pegasus PPBA`).
   - Every device has `reason: "commands-disabled"` and `held: false`.
   - `open: 0`.

## 1. Deploy Vela on thuban

The running stack is built from `~/dev/personal/vela` with `compose.yaml`. See [Running Vela in Docker](../docker.md) for the layout.

1. Open `http://thuban:5173` and check that no capture, autofocus, framing or alignment is running on any rig.
2. Record the rollback point. Run these commands once. A second run after the edit overwrites the backups with the edited files.

   ```sh
   cd ~/dev/personal/vela
   git switch main
   git status --short
   git rev-parse HEAD > ~/vela-pre-p5.sha
   docker tag vela-server:local vela-server:pre-p5
   docker tag vela-web:local vela-web:pre-p5
   cp ~/.config/vela/cria.json ~/.config/vela/cria.json.pre-p5
   cp ~/.local/share/vela/rigs.yaml ~/.local/share/vela/rigs.yaml.pre-p5
   ```

   `git status --short` must print nothing. If it prints anything, stop and find out why before you pull.
3. Replace `~/.config/vela/cria.json` with this file. Only the URL and the device names change. The device IDs already match Cria's.

   ```json
   { "rigs": [ {
     "id": "fra-cria", "name": "FRA 400 · Cria", "url": "http://100.104.187.54:4319",
     "devices": [
       { "id": "primary", "kind": "camera",  "expectedName": "ZWO CCD ASI2600MC Pro" },
       { "id": "guide",   "kind": "camera",  "expectedName": "ZWO CCD ASI220MM Mini" },
       { "id": "focuser", "kind": "focuser", "expectedName": "ZWO EAF" },
       { "id": "mount",   "kind": "mount",   "expectedName": "ZWO AM5" },
       { "id": "weather", "kind": "weather", "expectedName": "Pegasus PPBA" },
       { "id": "switch",  "kind": "switch",  "expectedName": "Pegasus PPBA" }
     ],
     "imagingCameraId": "primary", "focalLengthMm": 400,
     "alignment": { "mode": "physical", "cameraId": "primary", "telescopeId": "mount" }
   } ] }
   ```

   Check the syntax with `jq . ~/.config/vela/cria.json`. Do not edit `rigs.yaml`.
4. Pull, build and start. The build downloads `@cria/primitives` and `@cria/wire` from GitHub, so thuban needs internet access for this step.

   ```sh
   cd ~/dev/personal/vela
   git pull --ff-only
   test -f docs/observing/protocol-5-cutover.md && echo ok
   docker compose up -d --build
   docker compose ps
   docker compose logs -f server
   ```

   The `test` line prints `ok` only if the pull brought in this change. If it prints nothing, stop. Wait until `docker compose ps` shows the server `healthy` and the web container `Up`.

### Roll back

Roll back only if the new Vela fails to start or misbehaves before you enable commands. The old Vela speaks protocol 4, so after a rollback it cannot reach the FRA 400 on errai. The Seestar and saved images work as before.

1. Stop the stack and restore the two files. The restored `rigs.yaml` drops any catalog change made since the backup, such as a new focal length.

   ```sh
   cd ~/dev/personal/vela
   docker compose stop
   cp ~/.config/vela/cria.json.pre-p5 ~/.config/vela/cria.json
   cp ~/.local/share/vela/rigs.yaml.pre-p5 ~/.local/share/vela/rigs.yaml
   ```

2. Start the previous images:

   ```sh
   docker tag vela-server:pre-p5 vela-server:local
   docker tag vela-web:pre-p5 vela-web:local
   docker compose up -d --no-build
   ```

3. Put the checkout at the same commit, so that a later `docker compose up -d --build` does not rebuild the new Vela:

   ```sh
   git switch --detach "$(cat ~/vela-pre-p5.sha)"
   ```

   If the `pre-p5` images are missing, run `docker compose up -d --build` after this command instead of step 2. Return to `main` later with `git switch main`.

## 2. Check readings with commands disabled

Do not press any command button in this section.

1. Open **Your rig** at `http://thuban:5173/rigs/fra-cria`. The page names the rig **FRA 400 · Cria** and lists six devices under **Equipment**, each marked **Connected**.
2. Check the imaging camera. The `ZWO CCD ASI2600MC Pro` row reads **Camera · Main camera**, and the `ZWO CCD ASI220MM Mini` row reads **Other camera · Not used for imaging**. The old saved display name does not require **Save imaging setup**. If the selected device is missing or its configured identity differs, stop and check `cria.json`.
3. Open each device's details with its chevron, for example **Show ZWO AM5 details**. Each device shows a message that commands are disabled. Cria's text for that reason is "Commands are disabled in the Cria configuration". No device shows a hold.
4. Open the capture page at `http://thuban:5173/rigs/fra-cria/observe/capture`. It shows **Capture unavailable** with the commands-disabled reason.
5. Check that the readings are present and update:

   - The camera's temperature and cooler state, in its device details or under **Camera cooling** on the capture page.
   - The focuser's position on its row, **Focuser · Position** *n*, between 15500 and 38000.
   - The mount's **Tracking on** or **Tracking off** state on its row, and **Parked** or **Not parked**. Read its RA and Dec from Cria with the command below.
   - The weather readings in the weather device's details.

   ```sh
   curl -s http://100.104.187.54:4319/v2/state | jq '.devices[] | select(.id == "mount") | .readings | {rightAscensionHours, declinationDegrees, tracking, parked}'
   ```

6. Write down the starting state:

   | Reading | Starting value |
   | --- | --- |
   | Focuser position (P0) | |
   | Mount parked | |
   | Mount tracking | |
   | Camera cooler and setpoint | |

7. Optional: check the interruption display. Ask the observer to restart Cria on errai with `systemctl --user restart cria.service`. Within a few seconds the device rows show **Last known**, and their details say "Last known measurements; live updates are interrupted." Vela retries every second. Once Cria is back, the rows return to **Connected**. Nothing was running, so Vela sends nothing again.

## 3. Enable commands

1. The observer sets `commandsEnabled: true` in Cria's configuration on errai and runs `systemctl --user restart cria.service`.
2. Read Cria's state again with the command in [step 0](#0-check-the-preconditions). Continue only if it shows `commandsEnabled: true`, every device with `held: false`, and `open: 0`. A device can show `reason: "starting"` for a few seconds after the restart. Read again until no device has a reason.
3. In Vela, the commands-disabled messages are gone from the device details, and the capture page no longer shows **Capture unavailable**.

## 4. Take one short dark

1. Put the lens cap on.
2. On the capture page, set **Exposure · seconds** to `1`.
3. Clear **Repeat until stopped**. The button changes to **Take exposure**.
4. Clear **Save frames** unless you want to keep the dark.
5. Press **Take exposure**.
6. Expect **Capturing** with a countdown and finally **Image received**. A short **Receiving image** phase can pass between refreshes. The preview shows the dark. The summary shows `1 completed` and no `lost` count.
7. Check the operation on Cria:

   ```sh
   curl -s http://100.104.187.54:4319/v2/state | jq '[.operations[] | select(.kind == "capture")] | last | {state, outcome: .outcome.kind}'
   ```

   Expect `state: "settled"` and `outcome: "confirmed"`.

## 5. Move the focuser a small distance

Vela has no manual focuser move. This step starts autofocus and stops it after its first move, so the focuser moves out and back.

1. Open **Autofocus** at `http://thuban:5173/rigs/fra-cria/observe/autofocus`. Check that the focuser still reads P0 on **Your rig**.
2. Set **Step size** to `50`. **Planned window** then shows P0 − 200 to P0 + 200, which must lie inside 15500 to 38000. If the page shows **Window does not fit**, stop.
3. **Short exposure** shows 2 seconds per sample. The page does not change it.
4. Press **Start autofocus**. The focuser moves first to P0 + 200, the outer end of the window.
5. When the large position number changes from P0, press **Stop and restore start**.
6. Expect **Restoring start…**, then **Confirmed stop** with **Start position restored**. The page says the focuser is back at P0.
7. Check that the focuser row on **Your rig** reads P0 and that no device shows a hold.

The walk can also end before you press stop, because the cap leaves no stars. Then expect **Walk failed · start restored** with the focuser at P0. If the page shows **Restoration failed** or **Start position not confirmed**, stop and follow [If an operation ends uncertain](#if-an-operation-ends-uncertain).

## 6. Cancel one slew

1. Write down the mount state from **Your rig**.
2. If the mount is parked, open **Show ZWO AM5 details** and press **Unpark mount**. Expect "Mount confirmed unparked."
3. If tracking is off, press **Turn tracking on**. Expect "Tracking confirmed on." Framing refuses to start while the mount is parked or not tracking.
4. Choose a target about 10 to 20 degrees from the current pointing, above the horizon and clear of the pier. Open it from **Targets** at `http://thuban:5173/rigs/fra-cria/observe/targets`.
5. Press **Slew & check**. The status reads **Moving to your composition**.
6. While the mount is visibly moving, press **Stop framing**.
7. Expect **Stopping framing**, then **Framing stopped**. Check the mount by eye. Read its RA and Dec from Cria again to confirm that they hold steady.
8. Check the operation on Cria:

   ```sh
   curl -s http://100.104.187.54:4319/v2/state | jq '[.operations[] | select(.kind == "mount-slew")] | last | {state, outcome: .outcome.kind}'
   ```

   Expect `outcome: "stopped"`. Cria confirms a cancelled slew only after the mount stands still, normally about 2 s after the abort. If it cannot confirm the stop within 20 s, it reports uncertainty and holds the mount.

## If an operation ends uncertain

An `uncertain` ending means the device may have moved or changed by an unknown amount. Cria holds the device's failure domain, and Vela refuses rig operations until a person recovers it.

1. Do not repeat the command.
2. Read the hold's reason. **Your rig** shows it in the device's details, and the capture page shows it under **Capture unavailable**. Cria shows it too:

   ```sh
   curl -s http://100.104.187.54:4319/v2/state | jq '.devices[] | select(.quarantine.held) | {id, reason: .quarantine.reason}'
   ```

   A hold that Vela created after losing track of a request, for example when Cria restarted mid-operation, shows only in Vela.
3. Check the device by eye. For the mount, confirm that it is stationary and clear of the pier.
4. Recover the device only when it is safe. If it is not safe, stop and leave the hold in place.

### Recover a held device

Call the temporary route through the web container. Vela's device ID is `cria:fra-cria:` followed by Cria's device ID, for example `cria:fra-cria:mount`. Describe what you checked in `note`. A recovery clears the device's whole failure domain. `weather` and `switch` share the `pegasus-ppba` domain, so one call recovers both.

```sh
curl -s -X POST http://thuban:5173/api/rigs/fra-cria/devices/cria:fra-cria:mount/recover \
	-H 'content-type: application/json' \
	-d '{"externalRecoveryConfirmed": true, "note": "Checked the AM5 by eye: stationary and clear of the pier."}'
```

A successful call returns HTTP 200 with `outcome: "confirmed"` and a `found` message. A refusal returns HTTP 409 with the reason. Read the Vela capture page again, including for a Vela-local hold. Read the Cria hold query again for remote quarantine. Continue only when Vela no longer shows the hold.

## 7. Return to the starting state

1. Set tracking back to its starting value with **Turn tracking on** or **Turn tracking off**.
2. Vela has no park command. If the mount started parked, park it from the AM5's own control.
3. Ask the observer to set `commandsEnabled` the way Chris wants it for the party.
4. Check the focuser position against P0 and the cooler against its starting value.
5. Write down anything left changed.
