---
tags: [system]
updated: 2026-10-12
sources: [17, 22]
---

# Ego sedan mesh

The player car is Kenney’s Car Kit **sedan-sports** (`sedan-sports.glb`, CC0, [kenney.nl/assets/car-kit](https://kenney.nl/assets/car-kit)), served from `game/public/models/` and loaded with Three.js `GLTFLoader`. Attribution lives in `game/public/models/ATTRIBUTION.md` and `README.md`.

Fit: ~4.7 m long × 1.85 m wide × 1.45 m tall. Body-paint colormap cells (including the dark-grey hood/door cells) are tinted silver. Only greenhouse window faces are split out as dark glass. Lights, trim and tyres keep their original colours. Kenney +Z-forward is rotated to sim +X-forward. Wheels (`wheel-front-left` etc.) are detached onto planted pivots at `AXLE_HEIGHT` so cosmetic roll/pitch of `bodyPivot` does not lift them off the road. Front pivots yaw with steer; meshes spin on the axle.

First-person does not render the exterior shell (camera layer `LAYER_EXTERIOR`) and does not draw the 3D perception overlay. A separate cockpit group (`LAYER_COCKPIT`) uses matte `MeshStandardMaterial` plus a cabin fill light: windshield frame (A-pillars + header), long dark dash with an orange ambient strip, ~15" landscape tablet (live speed, AUTO/MANUAL, top-down lane), steering column, two-spoke round wheel with a hub plate, optional dim hands/knees. Eye/look anchors on `bodyPivot` are what the hood camera copies each frame ([[pr-tesla-fp]]). This **supersedes** the thin grey dash / three-spoke beige-mark wheel from [[pr-22]] as the live cockpit.

Do not replace `updateVehicle`, `removeGround`, or `createBEVOccupancyFromAgents`. `simHotPath.ts` stays unused.

## Key files

- `game/src/sim/egoMesh.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/public/models/sedan-sports.glb`
- `game/public/models/ATTRIBUTION.md`
