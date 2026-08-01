<p align="center">
  <img src="public/ui/menu/logo-game.png" alt="Joe Must Drive" width="420" />
</p>

<p align="center">
  <strong>A first-person sidecar zombie survival game built for Vibe Jam 2026.</strong>
</p>

<p align="center">
  <a href="https://github.com/ralvyathaya/VibeJam-Game/actions/workflows/ci.yml"><img src="https://github.com/ralvyathaya/VibeJam-Game/actions/workflows/ci.yml/badge.svg" alt="CI status" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/code%20license-MIT-blue.svg" alt="MIT code license" /></a>
  <img src="https://img.shields.io/badge/Three.js-TypeScript-black" alt="Three.js and TypeScript" />
</p>

Ride shotgun through a ruined highway, survive zombie swarms, collect risky
weapon pickups, and fight a helicopter boss. Play solo or split control between
a Driver and Gunner in online co-op.

## Highlights

- First-person combat with handgun, shotgun, assault rifle, and bazooka.
- Online Driver + Gunner co-op with room codes and no account required.
- Host-authoritative synchronization for players, enemies, pickups, rewards,
  vehicle state, and the boss encounter.
- Helicopter boss with weak points, telegraphed attacks, and lane projectiles.
- Mobile touch controls, responsive menus, loading progress, and asset fallbacks.
- Rain, lightning, ramp jumps, reactive audio, and post-processing effects.

## Tech

| Area | Implementation |
| --- | --- |
| Client | Three.js, TypeScript, Vite |
| Multiplayer | Browser WebSockets and a lightweight `ws` relay |
| Rendering | GLB assets, procedural fallbacks, custom speed shader |
| Architecture | Game loop with focused gameplay, UI, audio, and network systems |

The host simulates authoritative gameplay and broadcasts snapshots. The relay
only forwards small JSON messages between the two players; it does not process
game simulation or serve runtime assets.

## Run locally

Requires Node.js 22.12 or newer.

```bash
npm install
npm run dev
```

Open the URL printed by Vite. Single-player works without the relay.

For co-op, start the relay in a second terminal:

```bash
npm run relay
```

The client uses `ws://localhost:8787` locally. Set `VITE_COOP_WS_URL` when the
deployed relay is hosted at a different address:

```bash
VITE_COOP_WS_URL=wss://example.com npm run build
```

## Controls

| Input | Gunner | Driver |
| --- | --- | --- |
| Mouse | Aim | Look |
| Left click | Fire | Fire pistol |
| `R` | Reload | Reload |
| `A` / `D` | Call lane | Steer |
| `W` / `S` | — | Accelerate / brake |
| `Esc` | Pause / release pointer lock | Pause / release pointer lock |

Touch controls are shown automatically on supported mobile layouts.

## Scripts

```bash
npm test          # Run the Node test suite
npm run build     # Type-check and create a production build
npm run preview   # Preview the production build
npm run relay     # Start the co-op WebSocket relay
```

Every push and pull request runs the test and production build through GitHub
Actions.

## Deployment

The client is a static Vite build and can be hosted on any static host. The
WebSocket relay requires a Node.js host; [`railway.json`](railway.json) contains
the included Railway configuration and `/health` is available for health checks.

## AI-assisted production

AI tools assisted parts of the code, image, sound, voice, and music workflow.
System design, integration, debugging, gameplay tuning, and final acceptance
remain the responsibility of the project author. See
[`ASSET_ATTRIBUTION.md`](ASSET_ATTRIBUTION.md) for the current provenance and
reuse status of shipped assets.

## License

Source code is available under the [MIT License](LICENSE). Art, models, audio,
music, fonts, logos, and other media under `public/` are **not** covered by the
MIT License; see [asset attribution](ASSET_ATTRIBUTION.md) before reusing them.
