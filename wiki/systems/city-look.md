---
tags: [system]
updated: 2026-10-14
sources: []
---

# City look (lighting, materials, post)

The live scene uses a hemisphere light plus one directional sun. The sun’s PCF-soft shadow camera is a **tight frustum** (~38 m) that follows the ego — one cascade, not a city-wide map. Renderer uses ACES filmic tone mapping and sRGB output. A back-face sky-dome shader paints a horizon gradient; linear fog (~70–240 m) hides far-building pop-in.

Materials are procedural CC0 canvas textures (`cityTextures.ts`): worn asphalt, tiled sidewalk, curb, varied grass, facade atlas + emissive window atlas. Static boxes get instance / vertex AO. Buildings are two `InstancedMesh` lists (near textured, far impostor) updated at 5 Hz. Trees, poles, lamps, and road marks stay instanced.

**Look High** (Esc) enables the sun shadows plus half-res bloom and a 16³ colour LUT. **Look Low** and Quality Low skip post. Pixel ratio is capped at 1.5. Lidar / BEV overlays stay on top: points are dimmer, stable (no per-frame jitter), and bloom threshold is high so cyan dots do not glow.

Does not change planner, `obstacleAhead`, or `updateVehicle`.

## Key files

- `game/src/render/cityLook.ts`
- `game/src/render/cityTextures.ts`
- `game/src/render/postFx.ts`
- `game/src/main.ts`
- `docs/licenses/graphics.md`
