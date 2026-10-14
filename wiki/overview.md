---
tags: [overview]
updated: 2026-10-14
sources: [1, 2, 3, 19, 20, 22, 24, 25, 27, 28, 29, 30, 32]
---

# Overview

AUTONOMY CITY is a browser 3D self-driving city. You watch or drive a sedan while three public-style stacks show how they see the street. A Python data engine mines recordings, labels them, trains perception/policy models, and can export ONNX.

It is an educational sim, not a product of the named companies.

## Current state (after Tesla FP / re-engage work)

- City only. F1 Tesla-style, F2 Waymo-style, F3 Waabi-style, plus compare mode. F4 Aurora, F5 rail, and F6 maritime were removed in [[pr-3]].
- Game loop is a fixed **30 Hz** step with render interpolation (`SIM_DT = 1/30` in `main.ts`).
- Start menu: **Just drive** parks with no route; autopilot still needs a map start and end ([[pr-19]], which superseded the direction-only menu in [[pr-10]] and the “must pick a trip” rule in [[pr-13]]). The end click is the pink destination pin.
- Autopilot follows a Manhattan **right-hand-lane** route and slows for grid corners so it stays on asphalt ([[pr-18]], [[pr-20]]). Right turns cut the near corner; left turns go wide. A map trip ends at a **pink roadside pad**; the stack pulls over onto it and stops.
- Pedestrians walk sidewalks, wait, and cross; cars yield to anyone **on the asphalt or crossing** ([[pr-5]]) and also at junctions ([[pr-20]]). Sidewalk waiters do not freeze a junction.
- Intersections are a seeded mix of all-way **STOP**, **YIELD** (minor road), and **uncontrolled** — about a third each. Ego and every AI traffic car share `decideIntersection`. This **supersedes** cycling traffic lights as the live control (true through [[pr-19]]). AI traffic random-walks the grid, never reverses, never camps the box, and a 3 s deadlock breaker releases the earliest arrival. The ego is treated as traffic by NPC follow.
- Tesla HUD detections match vision boxes, including stop/yield signs. Manual banner reads **Manual — press T to re-engage**; T or the banner replans Auto from the current pose ([[pr-25]]).
- Lidar rays can run in Rust/WASM (`cast_rays` only). Vehicle integration, ground removal, BEV occupancy, and the impulse collision solver stay in TypeScript. See [[decisions]] and [[lidar-wasm]]. The live F3 HUD calls `runWaabiStack` again (the [[pr-26]] 10 Hz overlay was reverted).
- Ego vs cars / poles / signs / pedestrians uses mesh-matched OBBs and capsules, a spatial hash, and an impulse that can spin and shove traffic, snap street furniture above ~22 km/h, and tumble pedestrians. A counted hit increments the HUD and drops autopilot to manual.
- Autopilot does not full-brake for roadside poles, trees, signs, or buildings off the asphalt, so left turns at corner poles complete. Contact with a pole still collides.
- Reproducible shots: `?seed=` (default 3) and `?demo=lane|left|right|stop|yield|mix|queue|arrive|hit-car|hit-pole|hit-sign|hit-ped`.
- Ego exterior is Kenney’s CC0 sedan-sports GLB (silver paint, dark glass, wheels in the arches). Live first person is a locked left-seat Tesla-style cockpit; the GLB and debug rays are hidden ([[ego-mesh]], [[pr-25]]). Right-side HUD cards share a 300px column, collapse, close, drag, and each has a **?** popover ([[hud]]).

## How to run

- `make dev` rebuilds WASM then starts Vite.
- `cd game && npm run dev` is enough when `game/crates/autonomy-sim/pkg/` is already committed.
- Tests: `cd game && npm test` (Vitest). Full: `make test`.

## Key files

- `README.md`
- `Makefile`
- `game/src/main.ts`
- `game/src/sim/simulation.ts`
- `pipeline/`
