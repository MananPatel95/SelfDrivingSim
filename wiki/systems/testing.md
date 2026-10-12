---
tags: [system]
updated: 2026-10-12
sources: [3, 18, 20, 22]
---

# Testing and screenshots

Vitest lives next to the code (`game/src/**/*.test.ts`). `cd game && npm test` runs the suite. `make test` also runs `pipeline` pytest.

Planner corner tests drive `planTrajectory` + `updateVehicle` and assert the car stays on a 14 m asphalt cross. City-life tests keep trees off the road and pedestrians on sidewalks.

[[pr-20]] added:

- `rightLane.test.ts` — spawn/lanes/routes stay right of the yellow line; ego holds the lane on a straight and a right turn
- `intersectionRules.test.ts` — ~1/3 mix, full stop, yield-to-major, yield-to-right, Tesla HUD count, Manual banner
- `trafficStop.test.ts` — several NPCs at an all-way stop: each full-stops, no overlap, they leave in arrival order

[[pr-25]] added `hudPanels.test.ts` (no overlapping rects at 1280×720 and 1920×1080; collapsed and dragged cards miss the minimap/banner) and `reengage.test.ts` (takeover → re-engage → replan; cruise with no trip; stop/yield still applied).

Screenshots used in PRs and `README.md` sit in `docs/screenshots/`. They are captured from the running Vite app (headless Chrome or a live session), not from unit tests. Intersection shots 16–20 use `?seed=3` and `?demo=`. Cabin/sedan shots for [[pr-22]] are `cabin3_cockpit_*.png` (staged; **superseded** as a live-view record by the driving stills from [[pr-25]]).

## Key files

- `game/package.json`
- `game/src/planning/planner.test.ts`
- `game/src/sim/rightLane.test.ts`
- `game/src/sim/intersectionRules.test.ts`
- `game/src/sim/trafficStop.test.ts`
- `game/src/ui/hudPanels.test.ts`
- `game/src/sim/reengage.test.ts`
- `docs/screenshots/README.md`
