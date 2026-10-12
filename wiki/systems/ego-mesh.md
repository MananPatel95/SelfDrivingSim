---
tags: [system]
updated: 2026-10-12
sources: [17, 22]
---

# Ego sedan mesh

The player car is Kenney’s Car Kit **sedan** (`sedan.glb`, CC0, [kenney.nl/assets/car-kit](https://kenney.nl/assets/car-kit)), served from `game/public/models/` and loaded with Three.js `GLTFLoader`. Attribution lives in `game/public/models/ATTRIBUTION.md` and `README.md`.

Fit: ~4.7 m long × 1.85 m wide × 1.45 m tall, silver paint. Kenney +Z-forward is rotated to sim +X-forward. Wheels (`wheel-front-left` etc.) are detached onto planted pivots at `AXLE_HEIGHT` so cosmetic roll/pitch of `bodyPivot` does not lift them off the road. Front pivots yaw with steer; meshes spin on the axle.

First-person does not render the exterior shell (camera layer `LAYER_EXTERIOR`); a separate cockpit group (`LAYER_COCKPIT`) draws a thin dash, centre screen, 36 cm wheel, and thin A-pillars. No roof plane.

Do not replace `updateVehicle`, `removeGround`, or `createBEVOccupancyFromAgents`. `simHotPath.ts` stays unused.

## Key files

- `game/src/sim/egoMesh.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/public/models/sedan.glb`
- `game/public/models/ATTRIBUTION.md`
