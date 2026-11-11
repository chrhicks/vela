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
- `src/routes/<route>/`: one folder per route, with its page, its styles and its stub values.
- `src/components/`: the pieces every route shares: `Page`, `PageHeader`, `Facts`, `Readings`, `ActionLink`, `PillLink`. Each is one `.tsx` file and one CSS module.
- `src/styles/tokens.css`: the colours, type sizes and spacing. Components use these variables and no literal colours.

## State of the build

This is the shell. Every value on screen comes from a `stub.ts` beside the page; nothing reads the rig yet. The stub values have the shape the pages will later receive from the rig stream, so wiring in real data changes the source and leaves the components alone.

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
