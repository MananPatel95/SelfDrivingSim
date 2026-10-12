---
tags: [system]
updated: 2026-10-12
sources: [3, 18, 20, 22, 24, 25, 26, 27]
---

# Testing and screenshots

Vitest lives next to the code (`game/src/**/*.test.ts`). `cd game && npm test` runs the suite. `make test` also runs `pipeline` pytest.

Planner corner tests drive `planTrajectory` + `updateVehicle` and assert the car stays on a 14 m asphalt cross. City-life tests keep trees off the road and pedestrians on sidewalks. `vehicle.test.ts` also covers dry ABS stopping distance (50 and 100 km/h), time to peak decel, straight-line brake with no lateral drift, and standstill hold ([[pr-27]]).

[[pr-20]] added:

- `rightLane.test.ts` — spawn/lanes/routes stay right of the yellow line; ego holds the lane on a straight and a right turn
- `intersectionRules.test.ts` — ~1/3 mix, full stop, yield-to-major, yield-to-right, Tesla HUD count, Manual banner
- `trafficStop.test.ts` — several NPCs at an all-way stop: each full-stops, no overlap, they leave in arrival order
- `trafficFlow.test.ts` — random-walk exits, full-span reverse lanes, four cars arriving together, 2-minute N-car soak (progress, no reverse, no box camping)

[[pr-25]] added `hudPanels.test.ts` (no overlapping rects at 1280×720 and 1920×1080; collapsed and dragged cards miss the minimap/banner) and `reengage.test.ts` (takeover → re-engage → replan; cruise with no trip; stop/yield still applied).

`npm run bench:views` (`game/scripts/bench-views.ts`) prints F1/F2/F3 subsystem times. Pass `--browser` to also measure rAF FPS in headless Chrome at 1280×720 and 1920×1080 (`?demo=lane&stack=`). `src/render/f3Perf.test.ts` bounds F3 lidar scans (must stay 0 on the overlay path), occupancy allocs after warmup, static-entity walks, and PerceptionVisualizer typed-array allocs.

Screenshots used in PRs and `README.md` sit in `docs/screenshots/`. They are captured from the running Vite app (headless Chrome or a live session), not from unit tests. Intersection shots 16–20 use `?seed=3` and `?demo=`. Cabin/sedan shots for [[pr-22]] are `cabin3_cockpit_*.png` (including `cabin3_cockpit_wide.png`), `cabin3_exterior_*.png` (including `cabin3_exterior_hood.png`), and `cabin3_wheel_closeup.png` (staged; **superseded** as a live-view record by the driving stills from [[pr-25]]). Traffic-flow shots 21–23 for [[pr-24]] use `?seed=3&demo=mix` and `?demo=stop`. F3 occupancy stills: `verify-f3-dense-occupancy.png` and `verify-f3-perf.png` (`?demo=lane&stack=waabi`).

## Key files

- `game/package.json`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/intersectionRules.test.ts`
- `game/src/sim/trafficStop.test.ts`
- `game/src/sim/trafficFlow.test.ts`
- `game/src/ui/hudPanels.test.ts`
- `game/src/sim/reengage.test.ts`
- `game/src/render/f3Perf.test.ts`
- `game/scripts/bench-views.ts`
- `game/src/sim/vehicle.test.ts`
- `docs/screenshots/README.md`
