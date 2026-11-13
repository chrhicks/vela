# Vela's web app

The night at the rig, on a phone outside and a desktop inside. It replaces the single-file night page in `src/page/`.

## Routes

Each route serves one moment of the night.

| Route | Moment | Built for |
|---|---|---|
| `/launch` | Setting up at the rig | A phone, one step at a time |
| `/` | The run | A desktop second monitor, then a phone |
| `/controls` | Something needs correcting | Either |
| `/frame/<number>`, `/stack` | Judging a picture by eye | Either |

## Where things are

- `src/App.tsx`: the routes.
- `src/routes/<route>/`: one folder per route, with its pages, the components only it uses, and its stub values.
- `src/components/`: the pieces every route shares, each one `.tsx` file and one CSS module: `Page`, `PageHeader`, `Caption`, `Facts`, `Readings`, `Readout`, `StatusLine`, `Statement`, `Alert`, `Log`, `Chart`, `Picture`, `Choices`, `Field`, `ActionLink`, `ActionButton`, `PillLink`.
- `src/styles/tokens.css`: the colours, type sizes and spacing. Components use these variables and no literal colours.
- `src/stub/`: the sky picture and series the stubbed screens draw.

## State of the build

Every screen is drawn. Real data reaches the page through `src/rig/`: the service's event stream folded into a store by the reducers in `state/`. On real data now: the run page's header, latest frame, rig line (readings, guiding, flip) and trend charts; the link banners (no connection, rig silent); and on `/launch` the set-up checklist, bring-up, alignment, the filter question and autofocus, with their commands sent to `POST /commands`.

The rest still reads a `stub.ts` beside its page, shaped like what the stream will give, so wiring it changes the source and leaves the components alone: the target picker, the capture checks and the starting and night-over views, the ready step on `/launch`, `/controls`, and the frame and stack inspect views.

## /launch

Six steps, one address each, on a phone: `set-up` (the checklist), `bring-up` (the rig setting itself to the rig file), `align` (polar alignment), `filter`, `focus` (autofocus) and `ready` (the verdict). Polar alignment starts only from the tap on `ALIGN`.

## / (the run)

One address whose content follows the run: no run, the target picker (`READY`), the first-frames check (`LEAVE THE SCREEN`), capturing, capturing with an alert, and the night over (`READY TO CARRY IN`). On a desktop it is three columns to glance at; on a phone the same pieces are one column in a different order, with one picture and a switch between the latest frame and the stack. `routes/run/layout.module.css` holds both arrangements.

The picker (`routes/run/picker/`) lists what is best placed now, filters as you type on any of a target's names, and shows the chosen target with the camera's frame drawn over it. Two things are set there, the exposure and when the run stops; the end time is worked out from them (`ends-by.ts`). The chosen target is in the address (`&target=`), so on a phone the list and the chosen target are two screens.

Amber appears only in the alert and on the readings it concerns, so a page with no amber is a night that needs nothing.

## /frame/<number> and /stack

Clicking the latest frame or the stack on the run page opens it for judging the stars by eye: the whole picture with a box that follows a click, that box at 100 %, and nine crops at 100 % from the corners, edges and centre, since stars are often fine in the middle and stretched in one corner. A frame links to the one before and after it; the stack is a quick one for inspection, not a finished image.

## /controls

Every operation on the rig, by itself, in seven areas: mount, guiding, focus, camera, dew heater, calibration and system. Each area shows the true state first and its actions under it (`routes/controls/areas.tsx`). On a desktop all seven are on one page. A phone cannot fit them, so there `/controls` is the list of areas with one line of state each and `/controls/<area>` opens one, where the mount's nudge becomes a four-key pad; a desktop draws the whole page at either address. Whether the shut-down question is open is in the address (`?ask=shut-down`).

Nothing asks "are you sure?" and nothing is disabled during a run. The one exception is `SHUT DOWN RIG PC`: it sits apart in the header, quieter than the rest, and asks once, because the PC's power button is outside.

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
