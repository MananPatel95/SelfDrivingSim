---
tags: [source]
updated: 2026-10-15
sources: []
---

# Branch cursor/city-look-fix-7cdd — city look cleanup (draft)

## What changed

Follow-up to [[pr-34]] after merge to main.

- Asphalt / sidewalk textures are low-contrast isotropic noise. Shared `repeat (8, 40)` and grout / oil streaks are gone. Each ground mesh clones the map and sets UV from world metres / 8 m. Mipmaps + anisotropy ≤ 8.
- Block interiors get plazas, pads, or parking lots, a visual-only 2×2 of grey lot buildings, plus benches/bins/planters. Visual sidewalks are 6.5 m. Grass is no longer the block fill.
- Buildings drop the window-grid facade atlas and use the pre-#34 grey `InstancedMesh` palette. Near/far LOD stays.
- Pedestrian mesh forward is local +Z; yaw is `heading + π/2`, damped. Heading stays within 10° of `atan2(velocity)` while walking.

Planner, start-menu, spawn, `updateVehicle`, `removeGround`, `createBEVOccupancyFromAgents`, and `cast_rays` were not rewritten.

## Pages touched

city-look, pedestrians, testing, overview, index

## Key files

- `game/src/render/cityTextures.ts`
- `game/src/render/cityLook.ts`
- `game/src/main.ts`
- `game/src/sim/pedestrianVisual.ts`
- `game/src/sim/pedestrianVisual.test.ts`
