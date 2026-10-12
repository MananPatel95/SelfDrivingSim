---
tags: [system]
updated: 2026-10-12
sources: [17, 22]
---

# Ego sedan mesh

The player car is Kenney’s Car Kit **sedan-sports** (`sedan-sports.glb`, CC0, [kenney.nl/assets/car-kit](https://kenney.nl/assets/car-kit)), served from `game/public/models/` and loaded with Three.js `GLTFLoader`. Attribution lives in `game/public/models/ATTRIBUTION.md` and `README.md`.

Fit: ~4.7 m long × 1.85 m wide × 1.45 m tall. Only body-paint colormap cells are tinted silver; windows stay dark glass and trim, lights and tyres keep their original colours. Kenney +Z-forward is rotated to sim +X-forward. Wheels (`wheel-front-left` etc.) are detached onto planted pivots at `AXLE_HEIGHT` so cosmetic roll/pitch of `bodyPivot` does not lift them off the road. Front pivots yaw with steer; meshes spin on the axle.

First-person does not render the exterior shell (camera layer `LAYER_EXTERIOR`). A separate cockpit group (`LAYER_COCKPIT`) draws a full-width dash covering the bottom ~28% of the frame, a silver hood/cowl sliver, A-pillars from the dash corners to a thin roof header, a landscape ~15" centre tablet, a steering column, and a 36 cm wheel whose lower rim sits behind the dash. No roof tint plane.

Do not replace `updateVehicle`, `removeGround`, or `createBEVOccupancyFromAgents`. `simHotPath.ts` stays unused.

## Key files

- `game/src/sim/egoMesh.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/public/models/sedan-sports.glb`
- `game/public/models/ATTRIBUTION.md`
