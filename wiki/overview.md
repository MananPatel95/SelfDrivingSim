---
tags: [overview]
updated: 2026-10-12
sources: [1, 2, 3, 19, 20]
---

# Overview

AUTONOMY CITY is a browser 3D self-driving city. You watch or drive a sedan while three public-style stacks show how they see the street. A Python data engine mines recordings, labels them, trains perception/policy models, and can export ONNX.

It is an educational sim, not a product of the named companies.

## Current state (after PR #20)

- City only. F1 Tesla-style, F2 Waymo-style, F3 Waabi-style, plus compare mode. F4 Aurora, F5 rail, and F6 maritime were removed in [[pr-3]].
- Game loop is a fixed **30 Hz** step with render interpolation (`SIM_DT = 1/30` in `main.ts`).
- Start menu: **Just drive** parks with no route; autopilot still needs a map start and end ([[pr-19]], which superseded the direction-only menu in [[pr-10]] and the “must pick a trip” rule in [[pr-13]]).
- Autopilot follows a Manhattan **right-hand-lane** route and slows for grid corners so it stays on asphalt ([[pr-18]], [[pr-20]]). Right turns cut the near corner; left turns go wide.
- Pedestrians walk sidewalks, wait, and cross; cars yield to anyone in the lane ([[pr-5]]) and also at junctions ([[pr-20]]).
- Intersections are a seeded mix of all-way **STOP**, **YIELD** (minor road), and **uncontrolled** — about a third each. Ego and every AI traffic car share `decideIntersection`. This **supersedes** cycling traffic lights as the live control (true through [[pr-19]]).
- Tesla HUD detections match vision boxes, including stop/yield signs. Manual banner while parked in manual.
- Lidar rays can run in Rust/WASM (`cast_rays` only). Vehicle integration, ground removal, and BEV occupancy stay in TypeScript. See [[decisions]] and [[lidar-wasm]].
- Reproducible shots: `?seed=` (default 3) and `?demo=lane|stop|yield|mix|queue`.

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
