# Vela's web app

The night at the rig, on a phone outside and a desktop inside. It replaces the single-file night page in `src/page/`.

## Routes

Each route serves one moment of the night.

| Route | Moment | Built for |
|---|---|---|
| `/launch` | Setting up at the rig | A phone, one step at a time |
| `/` | The run | A desktop second monitor, then a phone |
| `/controls` | Something needs correcting | Either |

## Where things are

- `src/App.tsx`: the routes.
- `src/routes/<route>/`: one folder per route, with its pages, the components only it uses, and its stub values.
- `src/components/`: the pieces every route shares, each one `.tsx` file and one CSS module: `Page`, `PageHeader`, `Caption`, `Facts`, `Readings`, `Readout`, `StatusLine`, `Statement`, `Alert`, `Log`, `Chart`, `Picture`, `Choices`, `Field`, `ActionLink`, `ActionButton`, `PillLink`.
- `src/styles/tokens.css`: the colours, type sizes and spacing. Components use these variables and no literal colours.
- `src/stub/`: what stands in for the rig while there is no data. It is deleted when the stream arrives.

## State of the build

The UI is being built first, with no data behind it. Every value on screen comes from a `stub.ts` beside its page, shaped like what the page will later receive from the rig stream, so wiring in real data changes the source and leaves the components alone.

Drawn so far: all of `/launch` and every state of the run page, the target picker included. Still to draw: the frame inspect view and `/controls`.

A state that the rig decides (devices coming up, an alignment error jumping) is a scene: the page reads `?scene=` from the address. The strip at the bottom of the window lists the scenes of the current route. Three screens move on by themselves after a few seconds, as the real ones will when the rig finishes: bring-up, autofocus and the first-frames check.

## /launch

Six steps, one address each, on a phone: `set-up` (the checklist), `bring-up` (the rig setting itself to the rig file), `align` (polar alignment), `filter`, `focus` (autofocus) and `ready` (the verdict). Polar alignment starts only from the tap on `ALIGN`.

## / (the run)

One address whose content follows the run: no run, the target picker (`READY`), the first-frames check (`LEAVE THE SCREEN`), capturing, capturing with an alert, and the night over (`READY TO CARRY IN`). On a desktop it is three columns to glance at; on a phone the same pieces are one column in a different order, with one picture and a switch between the latest frame and the stack. `routes/run/layout.module.css` holds both arrangements.

The picker (`routes/run/picker/`) lists what is best placed now, filters as you type on any of a target's names, and shows the chosen target with the camera's frame drawn over it. Two things are set there, the exposure and when the run stops; the end time is worked out from them (`endsBy.ts`). The chosen target is in the address (`&target=`), so on a phone the list and the chosen target are two screens.

Amber appears only in the alert and on the readings it concerns, so a page with no amber is a night that needs nothing.

## The look

Black ground with one warm colour (`--ember`), and a brighter one (`--amber`) reserved for what needs attention. JetBrains Mono for readings and short capitalised codes, Inter for other words. No boxes or rules: spacing and type carry the structure. The fonts are bundled, so the page fetches nothing from outside.

## Commands

```sh
pnpm install
pnpm --dir web dev
pnpm --dir web build
pnpm --dir web typecheck
```

## Looking at it on thuban

`deploy/web-preview.sh [--commit REF]` builds the app in its own checkout (`~/dev/personal/vela-web-preview`, a clone of this repo) and serves it with the user unit `deploy/vela-web-preview.service` on `127.0.0.1:8794`. It is separate from the `vela` service, so building or restarting it never touches the rig. Run it again to show a newer commit. It goes away when the service under `src/` serves the built app itself.
