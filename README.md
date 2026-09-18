# Instrunyel Valve

An instrumentation engineering lab in the browser: ten valves, a live process behind each one, and
the 4-20 mA loop driving them.

This is a side project. I wanted to see what DeepSeek V4.1 Flash could do with 3D and engineering
equations, so I gave it one prompt and let it cook. It came out further than I expected and it
still has plenty of rough edges. The whole thing cost about 3% of a CommandCode GOAT plan.

## What is in the box

Ten valves: gate, globe, ball, characterised ball with a V port, butterfly, plug, swing check, dual
plate check, a cage guided control valve with a spring diaphragm actuator and positioner, and a pop
action relief valve.

Each one sits inside a working process, driven by a PID loop and by instruments that misbehave the
way real ones do: open circuit, short circuit, lost air supply, an I/P converter that was never
calibrated properly, and a pump that stops when it feels like it.

Nothing is animated by hand. Flow follows IEC 60534, the actuator is a force balance sitting behind
a real air volume, and the geometry is generated from standard dimensions instead of a model file.
The renderer reads the simulation and draws it. It does not get a vote.

## Running it

```sh
bun install
bun run dev
```

Open the URL Vite prints, then go to `/lab`.

## Verifying it

```sh
bun run verify          # svelte-check, tsc --noEmit, bun test
bun run build           # static bundle in build/
```

## Where everything is

| Path | What it holds |
| --- | --- |
| `src/lib/sim/` | The engineering: units, fluids, sizing, actuator, friction, signals, PID, valves |
| `src/lib/lab/` | Scenarios and the factory that builds a running simulator |
| `src/lib/three/` | The renderer: scene, procedural valve geometry, animation |
| `src/lib/components/` | The Svelte panels around the 3D view |
| `src/lib/content/` | Lesson text |

`src/lib/sim/` imports neither Three.js nor Rapier, so all the engineering runs and tests without a
browser.

## Deploying

`build/` is a plain static site, so any static host will do. This repo is wired for Cloudflare.

```sh
bun run deploy                  # build, then upload as a Workers project
bunx wrangler deploy --dry-run  # check the config without publishing
```

`wrangler.jsonc` describes an assets-only Workers project: no Worker script, no bindings, and
`not_found_handling` set to `single-page-application`, so a navigation request that matches no file
gets the app shell. The first deploy asks you to sign in to Cloudflare.

To let Cloudflare Pages build from Git instead, use these settings:

| Setting | Value |
| --- | --- |
| Framework preset | None |
| Build command | `bun run build` |
| Build output directory | `build` |
| Environment variable | `BUN_VERSION` set to `1.4.0` |

Their SvelteKit preset targets `adapter-cloudflare` and does not fit this project, which uses
`adapter-static`. Set `BUN_VERSION` for Production and Preview, because their build image ships a
Bun older than the lockfile committed here.

Workers get their SPA fallback from `wrangler.jsonc`. Pages has no such setting, so an unknown path
only reaches the app if a rewrite sends it there: add `static/_redirects` containing
`/*    /200.html   200` before deploying to Pages. That difference is why the file is not shipped
here.

## Standards it borrows from

IEC 60534-2-1 for control valve sizing, NAMUR NE43 for current loop faults, API 520 and API 526 for
relief valve capacity and orifice selection, ASME B16.5, B16.10 and B16.34 plus ISA-75.08.01 for
valve dimensions, and ASME BPVC Section VIII for relief valve overpressure and blowdown.

## Fine print

It is a teaching toy. A well read toy, but a toy. Do not size a real valve off it, unless you enjoy
explaining yourself to whoever signs the drawings.
