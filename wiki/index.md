---
tags: [index]
updated: 2026-10-15
sources: [1, 20, 22, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37]
---

# Wiki index

Read this first. Then open a page. Conventions live in `AGENTS.md`.

## Systems

- [Game loop and fixed step](systems/game-loop.md) — 30 Hz step, render interpolation
- [Vehicle physics](systems/vehicle-physics.md) — bicycle model, tyres, WASD
- [Collisions](systems/collisions.md) — impulse solver, capsules, snap / tumble
- [Perception F1 Tesla](systems/perception-tesla.md) — cameras, eight-camera ring, frustum sweep
- [Perception F2 Waymo](systems/perception-waymo.md) — lidar + radar fusion, sweep/decay
- [Perception F3 Waabi](systems/perception-waabi.md) — BEV occupancy, interpolated heat / ghosts
- [AI View](systems/ai-view.md) — insets, banner, compare
- [Lidar and Rust/WASM](systems/lidar-wasm.md) — `cast_rays` only
- [Planning and autopilot](systems/planning.md) — right-hand route, corners, pink roadside pad, stop/yield cap
- [Traffic rules](systems/traffic-rules.md) — stop / yield / uncontrolled, random walk, deadlock breaker
- [Pedestrians](systems/pedestrians.md) — sidewalks, crossings, tumble on hit
- [Camera](systems/camera.md) — chase, hood, BEV, orbit
- [City look](systems/city-look.md) — sun/PCF, ACES, textures, bloom/LUT
- [Ego sedan mesh](systems/ego-mesh.md) — Kenney CC0 sedan-sports + cockpit
- [HUD and menus](systems/hud.md) — start / arrived menu, 300px right column, ? popovers, pink dest pin, seed/demo, collision count
- [Data engine](systems/data-engine.md) — Python mine/label/train
- [Testing](systems/testing.md) — Vitest and screenshots

## Concepts

- [Fixed timestep](concepts/fixed-timestep.md) — physics vs display rate
- [Stack profiles](concepts/stack-profiles.md) — F1–F3, F4–F6 gone
- [Overview](overview.md) — what the project is now
- [Decisions](decisions.md) — scope and WASM

## Entities / modules

- [main.ts](entities/main-ts.md)
- [bevOverlay.ts](entities/bev-overlay.md)
- [snapshotLerp.ts](entities/snapshot-lerp.md)
- [simulation.ts](entities/simulation-ts.md)
- [vehicle.ts](entities/vehicle-ts.md)
- [planner.ts](entities/planner-ts.md)
- [intersectionRules.ts](entities/intersection-rules.md)
- [rightLane.ts](entities/right-lane.md)
- [trafficFlow.ts](entities/traffic-flow.md)
- [lidar.ts](entities/lidar-ts.md)
- [autonomy-sim crate](entities/autonomy-sim.md)

## Sources / PRs

- [PR #1](sources/pr-1.md) — data engine
- [PR #2](sources/pr-2.md) — streets, AI View, WASM (harbour later removed)
- [PR #3](sources/pr-3.md) — city-only, F4–F6 removed
- [PR #4](sources/pr-4.md) — GTA driving, explainers
- [PR #5](sources/pr-5.md) — trees, peds, minimap
- [PR #6](sources/pr-6.md) — planted grip
- [PR #7](sources/pr-7.md) — left steer, ped facing
- [PR #8](sources/pr-8.md) — ped walk cycle
- [PR #10](sources/pr-10.md) — parked start (superseded UI)
- [PR #11](sources/pr-11.md) — drive along the nose
- [PR #12](sources/pr-12.md) — paint-only curbs
- [PR #13](sources/pr-13.md) — map trip
- [PR #14](sources/pr-14.md) — Tesla 360° ring
- [PR #15](sources/pr-15.md) — minimap zoom
- [PR #16](sources/pr-16.md) — purple route
- [PR #17](sources/pr-17.md) — cabin wheel
- [PR #18](sources/pr-18.md) — corner turns
- [PR #19](sources/pr-19.md) — Just drive
- [PR #20](sources/pr-20.md) — right-hand lanes and stop/yield mix
- [PR #22](sources/pr-22.md) — Kenney sedan-sports + Tesla-style cockpit
- [PR #24](sources/pr-24.md) — traffic random walk, deadlock breaker
- [PR #25](sources/pr-25.md) — live first-person cockpit, stacked HUD panels, T re-engage
- [PR #26](sources/pr-26.md) — F3 Waabi view: 10 Hz occupancy, no second lidar
- [PR #27](sources/pr-27.md) — dry ABS sedan braking (~1 g)
- [PR #28](sources/pr-28.md) — revert F3 overlay extract; poles do not block turns
- [PR #29](sources/pr-29.md) — impulse collisions, snap, tumble
- [PR #30](sources/pr-30.md) — pink roadside destination + pull-over
- [PR #31](sources/pr-31.md) — orbiting start / arrived menu
- [PR #32](sources/pr-32.md) — shared 300px HUD column + ? popovers
- [PR #33](sources/pr-33.md) — opposite-side pad, legal U-turn, HUD % sprite
- [PR #34](sources/pr-34.md) — F2/F3 10 Hz overlay, city look, InstancedMesh / pooled points
- [PR #35](sources/pr-35.md) — isotropic ground, block fill, solid buildings, ped heading
- [PR #36](sources/pr-36.md) — lane spawn, stop-sign recovery, A→B / Random menu
- [PR #37](sources/pr-37.md) — GPU overlay animation, 10 Hz snapshot interpolation

There is no merged PR #9 (closed as redundant with the nose/mesh yaw work).

## Log

- [log.md](log.md)
