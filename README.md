# Vela

Chris's observing program. It reads the rig from its stream and sends commands as stream messages; it never talks to INDI.

The old Vela (web app, server, solver, archiver, rig model, workshop) was removed on 2026-11-07. It is in git history before the commit that removed it. This repo now holds:

- `src/catalog/`: OpenNGC target data (J2000).
- `src/sky/`: J2000 to epoch-of-date conversion.
- `compose.yaml`, `tools/nats/`: the NATS broker for the rig stream.

```sh
pnpm install
./verify.sh
```

Needs Node 26 and pnpm.
