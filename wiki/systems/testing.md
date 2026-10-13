---
tags: [system]
updated: 2026-10-13
sources: [3, 18, 20, 22, 24, 25, 27, 28, 29, 30]
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

Collision-response tests live in `collision.test.ts` (OBB/capsule overlap, spatial hash, momentum, off-centre spin, slow-vs-snap poles, swept thin poles, roadside `obstacleAhead` skip) and `collisionSim.test.ts` (HUD count, autopilot drop, shoved NPC, snapped pole/sign, tumbling pedestrian). Screenshot rigs: `?demo=hit-car|hit-pole|hit-sign|hit-ped`.

`poleTurn.test.ts` drives left / right / straight through a grid corner that has city poles and asserts `obstacleAhead` never full-brakes on them.

`destination.test.ts` / `rightLane.test.ts` cover the roadside pad (right-curb offset, slide off junctions, `tripRoute` tail) and a planner+vehicle pull-over that stops on the pad. Parked pose asserts heading error **< 5°** and every sedan corner on asphalt (`|x| < 7`). The live sim then holds with banner **Arrived**. Minimap tests assert the dest pin is `#ff2d8a` and still projects in manual. `?demo=arrive` is the screenshot rig.

Screenshots used in PRs and `README.md` sit in `docs/screenshots/`. They are captured from the running Vite app (headless Chrome or a live session), not from unit tests. Intersection shots 16–20 use `?seed=3` and `?demo=`. Cabin/sedan shots for [[pr-22]] are `cabin3_cockpit_*.png` (including `cabin3_cockpit_wide.png`), `cabin3_exterior_*.png` (including `cabin3_exterior_hood.png`), and `cabin3_wheel_closeup.png` (staged; **superseded** as a live-view record by the driving stills from [[pr-25]]). Traffic-flow shots 21–23 for [[pr-24]] use `?seed=3&demo=mix` and `?demo=stop`.

## Key files

- `game/package.json`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/intersectionRules.test.ts`
- `game/src/sim/trafficStop.test.ts`
- `game/src/sim/trafficFlow.test.ts`
- `game/src/ui/hudPanels.test.ts`
- `game/src/sim/reengage.test.ts`
- `game/src/sim/destination.test.ts`
- `game/src/sim/vehicle.test.ts`
- `game/src/sim/poleTurn.test.ts`
- `game/src/sim/collision.test.ts`
- `game/src/sim/collisionSim.test.ts`
- `docs/screenshots/README.md`
