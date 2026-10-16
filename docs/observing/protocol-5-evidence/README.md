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
The focused protocol 5 client run passed 52 tests across three files. The adapter
and server scenario run passed 24 tests across two files.

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

## Browser checks

The real web app was driven against a Fastify server whose equipment composition
used only the in-memory FakeCria. These screenshots record that run.

- [Capture while held](capture-held.png) shows the mount's reason and disabled
  capture controls.
- [Cooling while held](cooling-held.png) shows the same reason in Camera cooling.
- [Autofocus on a phone](autofocus-travel-mobile.png) shows MinStep 15500 and
  MaxStep 38000 at a 390-pixel viewport. The page had no horizontal overflow.

The temporary recovery route returned `outcome: "confirmed"`. Autofocus then
started, and **Stop and restore start** ended with **Confirmed stop** and
**Start position restored** at 20000. This is fake-device browser evidence;
Chris's browser and hardware acceptance is still required.
