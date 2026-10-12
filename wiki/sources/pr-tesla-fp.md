---
tags: [source]
updated: 2026-10-12
sources: []
---

# Tesla first-person cockpit, HUD panels, autopilot re-engage

Draft source page for `cursor/tesla-fp-cockpit-2b93`. Replace with `pr-N.md` once the GitHub number exists.

## What changed

First-person (hood) camera is **locked** to the left-seat eye anchors on the body pivot (~1.2 m, ~70° FOV). The Kenney sedan GLB stays on `LAYER_EXTERIOR` and is not drawn; debug / lidar viz is hidden in this mode. A Tesla-style cockpit overlay (`LAYER_COCKPIT`) draws a windshield frame (A-pillars + roof header), a long dark dash with an ambient strip, a ~15" landscape centre tablet (speed + lane viz + AUTO/MANUAL), and a two-spoke round wheel on a column (~40% of frame width, ~450° A/D lock). Matte `MeshStandardMaterial` plus a cabin fill light.

Right-side HUD cards (stack explainer, AI View, info) are a single column: collapse, close, drag by header, positions in `localStorage`. **P** resets a customised layout or toggles the column. Layout tests assert no overlapping rects at 1280×720 and 1920×1080, and no cover of the minimap, speed HUD, or centre banner.

**T** and the centre **Manual** banner re-engage autopilot: `reengageAutopilot()` rebuilds a right-lane route from the current pose to the trip destination (or cruises ahead with no trip), then the planner and stop/yield rules run as usual. Held WASD after T does not immediately steal control.

## Why

Live first-person (not the staged `?shot=cabin` stills) sat outside the cabin, showed the Kenney roof, a floating half-ring wheel, and overlapping HUD cards. WASD takeover had no path back to Auto.

## Pages touched

camera, ego-mesh, hud, planning, testing, ai-view, main-ts, simulation-ts

## Claims superseded

Supersedes the staged-cockpit claim in [[pr-22]] that live first-person already matched the Tesla interior. Re-engage **supersedes** “T toggles Auto but an empty route / held WASD leaves you stuck in Manual”.

## Key files

- `game/src/sim/cabinView.ts`
- `game/src/sim/egoMesh.ts`
- `game/src/sim/rightLane.ts`
- `game/src/sim/simulation.ts`
- `game/src/ui/hudPanels.ts`
- `game/src/main.ts`
- `game/index.html`
