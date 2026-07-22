# Joe Must Drive

First-person sidecar zombie survival game made for Vibe Jam 2026.

Drive through a ruined highway, survive zombie swarms, grab risky pickups, fight a helicopter boss, and optionally play online co-op as Driver + Gunner.

## Features

- First-person Three.js / TypeScript / Vite browser game.
- Solo mode with Gunner controls.
- Online co-op room flow with room codes, no login.
- Role split:
  - Driver: steer, accelerate, brake, and use pistol-only stance.
  - Gunner: aim, reload, and use handgun, shotgun, assault rifle, and bazooka.
- Host-authoritative co-op snapshots for map, health, death, ride, boss, pickup, and reward sync.
- Runtime FPS viewmodels loaded from GLB assets.
- Boss fight with weakpoints, lane projectiles, telegraphs, blast feedback, and helicopter audio.
- Rain, lightning, ramp jumps, pickups, Vibe Jam portal, HUD, pause menu, and death recap.
- Mobile support with touch controls and compact menu layout.

## Tech

- Three.js
- TypeScript
- Vite
- WebSocket relay using `ws`

## Requirements

- Node.js `>=22.12.0`
- npm

## Install

```bash
npm install
```

## Run Locally

Start the game client:

```bash
npm run dev
```

Open the Vite URL shown in the terminal.

## Run The Co-op Relay

In another terminal:

```bash
npm run relay
```

The relay defaults to:

```text
ws://localhost:8787
```

For production, deploy `server/relay.mjs` somewhere that supports WebSockets, then set the game relay URL through the project config/environment used by your deployment.

This repo includes `railway.json` for Railway:

```bash
npm start
```

Railway should expose:

```text
wss://your-railway-app.up.railway.app
```

## Build

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Controls

- Mouse: aim
- Left click: fire
- `R`: reload
- `A` / `D`: lane call / driver steer depending on mode
- `W`: accelerate as Driver
- `S`: brake as Driver
- `Esc`: pause / release pointer lock
- Mobile: touch buttons and tap-to-unlatch

## Co-op Flow

1. Host opens Co-op and creates a room.
2. Guest joins with the room code.
3. Host starts the run when both slots are filled.
4. Host simulates authoritative game state and broadcasts snapshots.
5. Guest sends input and receives corrected game state from host.

The relay only forwards small JSON messages. It does not send model or asset data.

## Assets

Runtime assets live under `public/`.

Main asset groups:

- `public/models/vehicles/`
- `public/models/viewmodels/`
- `public/models/bosses/`
- `public/models/enemies/`
- `public/audio/`
- `public/ui/`

Most art/audio in this project was AI-generated or AI-assisted. Before reusing assets outside this project, verify the license/source of each asset and replace anything that is not safe for your intended use.

## Development Notes

- Debug/tuning overlays are intended for local development only.
- Keep raw source assets outside `public/` unless they must ship.
- `dist/`, `node_modules/`, `.tmp/`, and `tmp/` are ignored.
- For game jam submission builds, keep post-deadline commits limited to clear bugfixes only.

## License

Code license and asset license are intentionally not declared in this README yet. Add explicit `LICENSE` and asset attribution files before treating this repo as fully open-source/reusable.
