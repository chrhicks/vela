# Protocol 5 cutover checks

All checks use fakes, local fixtures or recorded data. No rig, errai or real Cria
was contacted. Deployment and Chris's hardware acceptance remain separate steps
in the [cutover checklist](../protocol-5-cutover.md).

## Reproduce the checks

```sh
pnpm install
pnpm build
VITEST_MAX_WORKERS=1 pnpm check
pnpm exec vitest run packages/cria/test/v5
pnpm exec vitest run packages/cria/test/equipment.test.ts apps/server/tests/cria-protocol5.test.ts
```

The clean `main` baseline at `2d74b61` passed 1235 tests across 120 files.
On the rebased implementation, `pnpm install`, `pnpm build`, and
`VITEST_MAX_WORKERS=1 pnpm check` all exited 0. The final check passed 1186 tests
across 116 files, plus lint, type checks and builds. The count falls because the
protocol 4 client, fixture and adapter tests were deleted and replaced by the
protocol 5 checks. No test was disabled.

An earlier full run passed 1174 tests and failed one assertion that expected
the old mechanical-limit error text. That assertion now checks the exact travel-limit
message. The final run above includes it.

The focused protocol 5 client run passed 52 tests across three files. The final
adapter run passed 11 tests, and the server scenario suite passed all 15 tests
in the full run.

The server scenarios cover lost admission, unknown admission and recovery fencing,
recovery of an open command, cancel resends, 2-second and 19-second mount stops,
capture versus Stop, dropped images, restart uncertainty, quiet reconnection,
focuser halt resends, and hold refusal followed by recovery and autofocus.
There is no current server route for a held-mount halt or a raw cancel of an old
operation after restart. Those two cases remain covered by the client tests.

## Evidence that the checks catch a missing change

- The scenario delegate ran the 15 new route scenarios against the pre-flip
  `main`. All 15 failed, while the existing 1235 tests passed.
- The routes delegate ran the admission, camera identity and travel-window
  checks before implementation. Thirteen failed. The new alignment identity
  check failed separately. One added lease characterization already passed.
- The pre-aborted focuser check timed out before the Promise boundary checked
  an already-aborted signal. It now returns stopped without dispatch.
- The required-read check failed with `expected true to be false` when reads
  returned during Cria's `refreshing` state. It now waits for that state to clear.
- With the two uses of reported axis travel replaced by later telemetry, all
  three tests selected by `-t 'reported Cria axis travel'` failed. The source was
  restored before the final suite.

The first two red runs were performed in the delegates' isolated worktrees.
Their tests were then integrated and run against the actual production adapter.

The first full code review found one P1 issue. A failed image transfer after a
completed exposure was marked retryable, which let alignment request a replacement
exposure. A new HTTP-fault regression failed with `CaptureRetryableError` before
the correction. With the correction, the three download attempts still refer to
one original, the failure is terminal, and only one exposure is submitted. A
preflight read failure still permits a fresh attempt. Both checks pass in the
final 1186-test suite.

The Grok review found that autofocus still excluded valid endpoint positions,
and that the selected AM5 9x rate had a documented stop error larger than the
baseline corridor. The endpoint correction ran red with 12 failures and then
passed 40 focused autofocus checks. Two polar-rate checks failed before its
correction; all 49 physical-alignment checks pass now.

The reported Cria travel is inclusive. Legacy Alpaca keeps its previous one-step
margin. Physical alignment checks for an advertised rate near its existing 1°/s
requirement before homing or moving. The current AM5 has none. Its slower rate
cannot complete the leg within the pinned Cria's 120-second limit, so that rig's
physical baseline is explicitly deferred in the cutover checklist. Compatible
mounts still use reported travel and the 57° midpoint.

## Docker server image

The server target built successfully with no build cache, an empty Docker config,
and no credentials passed to the build:

```sh
mkdir -p .codex/pr6-flip/docker-config
printf '{}\n' > .codex/pr6-flip/docker-config/config.json
DOCKER_CONFIG="$PWD/.codex/pr6-flip/docker-config" env -u GH_TOKEN -u GITHUB_TOKEN docker build --no-cache --target server -t vela-pr6-server:verification .
DOCKER_CONFIG="$PWD/.codex/pr6-flip/docker-config" docker run --rm --network none --entrypoint node vela-pr6-server:verification --input-type=module -e 'import { createCriaConnection, createCriaEquipment } from "@vela/cria"; console.log(JSON.stringify({createCriaConnection: typeof createCriaConnection, createCriaEquipment: typeof createCriaEquipment}))'
```

The exported image manifest list is
`sha256:d9636e04c958f2162e39fb086d56dd6f96121584f21ae8e2b917bdfb75d8e0d0`.
The public Cria pin remains `86624908a57573b4953c2f759713b04d606defcd`.
The built image also loaded both `createCriaConnection` and `createCriaEquipment`
as functions with `docker run --rm --network none`. No connection was opened.

```json
{"createCriaConnection":"function","createCriaEquipment":"function"}
```

## Browser checks

The real web app was driven against a Fastify server whose equipment composition
used only the in-memory FakeCria. These screenshots record that run.

- [Capture while held](capture-held.png) shows the mount's reason and disabled
  capture controls.
- [Cooling while held](cooling-held.png) shows the same reason in Camera cooling.
- [Autofocus on a phone](autofocus-travel-mobile.png) shows the inclusive window
  15500..15900 ready to start from 15700 at a 390-pixel viewport. The page had no
  horizontal overflow. The walk started; Stop and restore start ended with
  Confirmed stop and Start position restored at 15700.

The temporary recovery route returned `outcome: "confirmed"` in the initial hold
fixture, and the next autofocus started. In the final endpoint fixture, **Stop
and restore start** ended with **Confirmed stop** and **Start position restored**
at 15700. This is fake-device browser evidence; Chris's browser and hardware
acceptance is still required.
