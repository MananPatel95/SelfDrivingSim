---
tags: [overview]
updated: 2026-10-15
sources: [1, 2, 3, 19, 20, 22, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 39]
---

# Overview

AUTONOMY CITY is a browser 3D self-driving city. You watch or drive a sedan while three public-style stacks show how they see the street. A Python data engine mines recordings, labels them, trains perception/policy models, and can export ONNX.

It is an educational sim, not a product of the named companies.

## Current state (after Tesla FP / re-engage work)

- City only. F1 Tesla-style, F2 Waymo-style, F3 Waabi-style, plus compare mode. F4 Aurora, F5 rail, and F6 maritime were removed in [[pr-3]].
- Game loop is a fixed **30 Hz** step with render interpolation (`SIM_DT = 1/30` in `main.ts`).
- Start / arrived menu: overlay on an orbiting city with **AUTONOMY CITY: How Machines See**. Pick F1 / F2 / F3, Chase or first person, and **A → B** (green-pin lane start, then pink pad) or **Random** (both ends, Reroll). Starts snap with `snapTripStart` into a mid-block right-hand lane; ends still use `snapTripEnd` + `resolveTripDestination` (arrival-side curb; opposite-side U-turn only when the pad is across the **same** street, [[pr-33]]). **Start** / Enter drives there on autopilot from the chosen start. Arrival reopens the same overlay; A → B’s start defaults to the parked pose. **Just drive** still parks with no route. If the stack is off-lane or stuck at a clear stop, it reverses and re-merges rather than sitting forever.
- Autopilot dests still use the shared right-hand pad rule. Tesla follows the Manhattan **nav** polyline from cameras; Waymo walks HD driving lanes; Waabi scores occupancy-forecast candidates attracted to that dest route. All three slow for grid corners so they stay on asphalt ([[pr-18]], [[pr-20]], [[pr-39]]). Right turns cut the near corner; left turns go wide. A map trip ends at a **pink roadside pad**.
- Pedestrians walk sidewalks, wait, and cross; cars yield to anyone **on the asphalt or crossing** ([[pr-5]]) and also at junctions ([[pr-20]]). Sidewalk waiters do not freeze a junction.
- Intersections are a seeded mix of all-way **STOP**, **YIELD** (minor road), and **uncontrolled** — about a third each. Ego and every AI traffic car share `decideIntersection`. This **supersedes** cycling traffic lights as the live control (true through [[pr-19]]). AI traffic random-walks the grid, never reverses, never camps the box, and a 3 s deadlock breaker releases the earliest arrival. The ego is treated as traffic by NPC follow.
- Tesla HUD detections match vision boxes, including stop/yield signs. Manual banner reads **Manual — press T to re-engage**; T or the banner replans Auto from the current pose ([[pr-25]]).
- Lidar rays can run in Rust/WASM (`cast_rays` only). Vehicle integration, ground removal, BEV occupancy, and the impulse collision solver stay in TypeScript. See [[decisions]] and [[lidar-wasm]]. The live F3 HUD is a 10 Hz `tickWaabiView` overlay with no second lidar. Live F1 / F2 / F3 planning is stack-faithful (vision+nav / HD lane graph / occupancy forecast); `obstacleAhead` is not injected on Tesla. See [[stack-planning]] and [[public-sources]].
- The city look is hemisphere + a tight-frustum PCF sun, ACES, a sky gradient, distance fog, low-contrast ground noise (no streaks), solid pre-#34 building boxes, filled block lots, and optional half-res bloom/LUT ([[city-look]]). Lidar dots are dimmer and use a fixed beam (no per-frame jitter). Pedestrian meshes face local +Z along velocity.
- Ego vs cars / poles / signs / pedestrians uses mesh-matched OBBs and capsules, a spatial hash, and an impulse that can spin and shove traffic, snap street furniture above ~22 km/h, and tumble pedestrians. A counted hit increments the HUD and drops autopilot to manual.
- Autopilot does not full-brake for roadside poles, trees, signs, or buildings off the asphalt, so left turns at corner poles complete. Contact with a pole still collides.
- Reproducible shots: `?seed=` (default 3) and `?demo=lane|left|right|stop|yield|mix|queue|arrive|arrive-opp|hit-car|hit-pole|hit-sign|hit-ped`.
- Ego exterior is Kenney’s CC0 sedan-sports GLB (silver paint, dark glass, wheels in the arches). Live first person is a locked left-seat Tesla-style cockpit; the GLB and debug rays are hidden ([[ego-mesh]], [[pr-25]]). Right-side HUD cards share a 300px column, collapse, close, drag, and each has a **?** popover ([[hud]]).

## How to run

- `make dev` rebuilds WASM then starts Vite.
- `cd game && npm run dev` is enough when `game/crates/autonomy-sim/pkg/` is already committed.
- Tests: `cd game && npm test` (Vitest). Full: `make test`.

## Key files

- `README.md`
- `Makefile`
- `game/src/main.ts`
- `game/src/ui/startMenu.ts`
- `game/src/sim/simulation.ts`
- `pipeline/`
