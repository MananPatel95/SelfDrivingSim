---
tags: [overview]
updated: 2026-10-12
sources: [1, 2, 3, 19]
---

# Overview

AUTONOMY CITY is a browser 3D self-driving city. You watch or drive a sedan while three public-style stacks show how they see the street. A Python data engine mines recordings, labels them, trains perception/policy models, and can export ONNX.

It is an educational sim, not a product of the named companies.

## Current state (after PR #19)

- City only. F1 Tesla-style, F2 Waymo-style, F3 Waabi-style, plus compare mode. F4 Aurora, F5 rail, and F6 maritime were removed in [[pr-3]].
- Game loop is a fixed **30 Hz** step with render interpolation (`SIM_DT = 1/30` in `main.ts`).
- Start menu: **Just drive** parks with no route; autopilot still needs a map start and end ([[pr-19]], which superseded the direction-only menu in [[pr-10]] and the “must pick a trip” rule in [[pr-13]]).
- Autopilot follows a Manhattan road route and slows for grid corners so it stays on asphalt ([[pr-18]]).
- Pedestrians walk sidewalks, wait, and cross; cars yield to anyone in the lane.
- Intersections still use cycling **traffic lights**. There is no stop/yield mix on `main` as of #19.
- Lidar rays can run in Rust/WASM (`cast_rays` only). Vehicle integration, ground removal, and BEV occupancy stay in TypeScript. See [[decisions]] and [[lidar-wasm]].
- Ego exterior is Kenney’s CC0 sedan-sports GLB (silver paint, dark glass, wheels in the arches). First person is a connected Tesla-style cockpit ([[ego-mesh]], [[pr-22]]).

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
