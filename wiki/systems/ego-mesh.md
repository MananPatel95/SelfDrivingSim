---
tags: [system]
updated: 2026-10-12
sources: [17, 22, 25]
---

# Ego sedan mesh

The player car is Kenney’s Car Kit **sedan-sports** (`sedan-sports.glb`, CC0, [kenney.nl/assets/car-kit](https://kenney.nl/assets/car-kit)), served from `game/public/models/` and loaded with Three.js `GLTFLoader`. Attribution lives in `game/public/models/ATTRIBUTION.md` and `README.md`.

Fit: ~4.7 m long × 1.85 m wide × 1.45 m tall. Body-paint colormap cells (including the dark-grey hood/door cells) are tinted silver. Only greenhouse window faces are split out as dark glass. Lights, trim and tyres keep their original colours. Kenney +Z-forward is rotated to sim +X-forward. Wheels (`wheel-front-left` etc.) are detached onto planted pivots at `AXLE_HEIGHT` so cosmetic roll/pitch of `bodyPivot` does not lift them off the road. Front pivots yaw with steer; meshes spin on the axle.

First-person does not render the exterior shell (camera layer `LAYER_EXTERIOR`) and does not draw the 3D perception overlay. A separate cockpit group (`LAYER_COCKPIT`) uses matte `MeshStandardMaterial` plus a cabin fill light: a **thin horizontal dash shelf** with an orange ambient strip (dash top **~72%** down the frame), a landscape tablet **in the dash to the right of the wheel**, a steering column, and a 36 cm round wheel **0.55–0.65 m** in front of the eye (flat oval hub ~30% of rim diameter, two thin side spokes plus a lower V, small TESLA plate). **No roof header and no A-pillars.** The hood camera is **88° FOV**, pitched **~11° down** so the horizon sits ~40% from the top. Eye/look anchors on `bodyPivot` are what the hood camera copies each frame ([[pr-25]]). This **supersedes** the camera-filling dash wall, giant hub, and framed A-pillar cabin from earlier [[pr-25]] cockpit passes, and the three-spoke wheel from [[pr-22]].

Do not replace `updateVehicle`, `removeGround`, or `createBEVOccupancyFromAgents`. `simHotPath.ts` stays unused.

## Key files

- `game/src/sim/egoMesh.ts`
- `game/src/sim/cabinView.ts`
- `game/src/sim/vehicleVisual.ts`
- `game/public/models/sedan-sports.glb`
- `game/public/models/ATTRIBUTION.md`
