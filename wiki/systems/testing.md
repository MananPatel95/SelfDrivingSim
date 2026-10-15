---
tags: [system]
updated: 2026-10-15
sources: [3, 18, 20, 22, 24, 25, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 39]
---

# Testing and screenshots

Vitest lives next to the code (`game/src/**/*.test.ts`). `cd game && npm test` runs the suite. `make test` also runs `pipeline` pytest.

Planner corner tests drive `planTrajectory` + `updateVehicle` and assert the car stays on a 14 m asphalt cross. City-life tests keep trees off the road and pedestrians on sidewalks. `vehicle.test.ts` also covers dry ABS stopping distance (50 and 100 km/h), time to peak decel, straight-line brake with no lateral drift, and standstill hold ([[pr-27]]).

[[pr-20]] added:

- `rightLane.test.ts` — spawn/lanes/routes stay right of the yellow line; ego holds the lane on a straight and a right turn
- `intersectionRules.test.ts` — ~1/3 mix, full stop, yield-to-major, yield-to-right, Tesla HUD count, Manual banner
- `trafficStop.test.ts` — several NPCs at an all-way stop: each full-stops, no overlap, they leave in arrival order
- `trafficFlow.test.ts` — random-walk exits, full-span reverse lanes, four cars arriving together, 2-minute N-car soak (progress, no reverse, no box camping)

[[pr-25]] added `hudPanels.test.ts` (no overlapping rects at 1280×720 and 1920×1080; collapsed and dragged cards miss the minimap/banner) and `reengage.test.ts` (takeover → re-engage → replan; cruise with no trip; stop/yield still applied). Layout tests also assert one shared width and one right edge for F1 (explainer + AI View) and F3 (those plus BEV). `hudPanelDom.test.ts` (happy-dom) checks the `?` popover open / click-outside / Esc path and that index.html uses `--hud-panel-width`.

Collision-response tests live in `collision.test.ts` (OBB/capsule overlap, spatial hash, momentum, off-centre spin, slow-vs-snap poles, swept thin poles, roadside `obstacleAhead` skip) and `collisionSim.test.ts` (HUD count, autopilot drop, shoved NPC, snapped pole/sign, tumbling pedestrian). Screenshot rigs: `?demo=hit-car|hit-pole|hit-sign|hit-ped`.

`poleTurn.test.ts` drives left / right / straight through a grid corner that has city poles and asserts `obstacleAhead` never full-brakes on them. `viewPerfTurns.test.ts` reuses the same `driveCorner` helper so those turns still complete after perception-scheduling changes. `f3Perf.test.ts` bounds F3 overlay lidar scans, occupancy allocs, and 10 Hz predicts. `npm run bench:views` reports F1/F2/F3 subsystem times. `cityLook.test.ts` covers vertex AO and procedural textures. `pedestrianVisual.test.ts` asserts walking heading stays within 10° of `atan2(velocity)`.

`destination.test.ts` / `rightLane.test.ts` cover the roadside pad (right-curb offset 5.775 m, slide off junctions, `tripRoute` tail) and a planner+vehicle pull-over that stops on the pad. Parked pose asserts heading error **< 5°** and every sedan corner on the **arrival road** (`onArrivalAsphalt` + `distanceToRightCurb` ~0.3 m), not `|x| < 7` (N–S only) or `pointOnAsphalt` (OR of both axes). Eastbound unit cases use the Y curb so `|x| < 7` would wrongly fail x≈50. The live sim then holds with banner **Arrived**. Opposite-side clicks assert a U-turn (route goes past the next junction) and Arrived on the left curb heading-aligned, with no cruise-stuck in-lane stop. A dest one left turn away asserts exactly one left, no U-turn, and a near-Manhattan length (a U-turn + right would add a block). Left, right, and straight trip routes all pass; a cross-street click that used to look "left of the last segment" no longer loops. `perceptionViz.test.ts` asserts world-space `%` sprites stay capped, fade with distance, and hide under the HUD. Minimap tests assert the dest pin is `#ff2d8a` and still projects in manual. `?demo=arrive` / `?demo=arrive-opp` are the screenshot rigs (those two demos clear traffic and pedestrians so a ped cannot steal the arrival).

`startMenu.test.ts` covers A → B (start then dest, reset, arrived default start) and Random (both pins, reroll), plus curb snaps and map pin round-trips. `recovery.test.ts` covers valid `beginTrip` spawn, reverse re-merge from the sidewalk, and not sitting forever at a clear stop. `rightLane.test.ts` also snaps a start click off the stop line. `?demo=` / `?shot=` still skip the overlay. `?demo=left-near` / `?ab=sx,sy,ex,ey` are the left-turn menu/live rigs. Live shots: `docs/screenshots/28-start-menu.png`, `29-arrived-menu.png`, `30-second-trip.png`, `39-menu-left-before.png`, `39-menu-left-after.png`, `39-left-turn-live.png`.

Screenshots used in PRs and `README.md` sit in `docs/screenshots/`. They are captured from the running Vite app (headless Chrome or a live session), not from unit tests. HUD column shots are `hud_f1_panels.png`, `hud_f2_panels.png`, `hud_f3_panels.png`, and `hud_f3_help_popover.png`. Intersection shots 16–20 use `?seed=3` and `?demo=`. Cabin/sedan shots for [[pr-22]] are `cabin3_cockpit_*.png` (including `cabin3_cockpit_wide.png`), `cabin3_exterior_*.png` (including `cabin3_exterior_hood.png`), and `cabin3_wheel_closeup.png` (staged; **superseded** as a live-view record by the driving stills from [[pr-25]]). Traffic-flow shots 21–23 for [[pr-24]] use `?seed=3&demo=mix` and `?demo=stop`.

## Key files

- `game/package.json`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/intersectionRules.test.ts`
- `game/src/sim/trafficStop.test.ts`
- `game/src/sim/trafficFlow.test.ts`
- `game/src/ui/hudPanels.test.ts`
- `game/src/ui/hudPanelDom.test.ts`
- `game/src/ui/viewCopy.test.ts`
- `game/src/sim/reengage.test.ts`
- `game/src/sim/destination.test.ts`
- `game/src/ui/startMenu.test.ts`
- `game/src/sim/recovery.test.ts`
- `game/src/render/perceptionViz.test.ts`
- `game/src/sim/vehicle.test.ts`
- `game/src/sim/poleTurn.test.ts`
- `game/src/sim/poleTurnDrive.ts`
- `game/src/sim/viewPerfTurns.test.ts`
- `game/src/render/f3Perf.test.ts`
- `game/src/render/cityLook.test.ts`
- `game/src/sim/pedestrianVisual.test.ts`
- `game/src/sim/collision.test.ts`
- `game/src/sim/collisionSim.test.ts`
- `docs/screenshots/README.md`
