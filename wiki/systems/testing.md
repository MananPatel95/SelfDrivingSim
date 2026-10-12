---
tags: [system]
updated: 2026-10-12
sources: [3, 18, 22]
---

# Testing and screenshots

Vitest lives next to the code (`game/src/**/*.test.ts`). `cd game && npm test` runs the suite. `make test` also runs `pipeline` pytest.

Planner corner tests drive `planTrajectory` + `updateVehicle` and assert the car stays on a 14 m asphalt cross. City-life tests keep trees off the road and pedestrians on sidewalks.

Screenshots used in PRs and `README.md` sit in `docs/screenshots/`. They are captured from the running Vite app (headless Chrome or a live session), not from unit tests. Cabin/sedan shots for [[pr-22]] are `cabin3_cockpit_*.png` (including `cabin3_cockpit_wide.png`), `cabin3_exterior_*.png`, and `cabin3_wheel_closeup.png`.

## Key files

- `game/package.json`
- `game/src/planning/planner.test.ts`
- `docs/screenshots/README.md`
