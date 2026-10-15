---
tags: [system]
updated: 2026-10-15
sources: [34, 35]
---

# City look (lighting, materials, post)

The live scene uses a hemisphere light plus one directional sun. The sun’s PCF-soft shadow camera is a **tight frustum** (~38 m) that follows the ego — one cascade, not a city-wide map. Renderer uses ACES filmic tone mapping and sRGB output. A back-face sky-dome shader paints a horizon gradient; linear fog (~70–240 m) hides far-building pop-in.

Materials are procedural CC0 canvas textures (`cityTextures.ts`): **low-contrast isotropic noise** on asphalt / sidewalk / curb (no grout, no oil streaks). Each ground mesh clones the map and sets UV repeat from world size / 8 m so tiles are square. Mipmaps plus anisotropy (up to 8) hide distant shimmer. Buildings use the pre-#34 solid grey palette on instanced boxes (near + far impostor LOD) — no window-grid atlas. Block interiors are plazas, concrete pads, or parking lots, a visual-only 2×2 of grey lot buildings, plus benches/bins/planters so the 1000 m grass plane is not the block fill. Trees, poles, lamps, and road marks stay instanced.

**Look High** (Esc) enables the sun shadows plus half-res bloom and a 16³ colour LUT. **Look Low** and Quality Low skip post. Pixel ratio is capped at 1.5. Lidar / BEV overlays stay on top: points are dimmer, stable (no per-frame jitter), and bloom threshold is high so cyan dots do not glow.

Does not change planner, `obstacleAhead`, or `updateVehicle`.

## Key files

- `game/src/render/cityLook.ts`
- `game/src/render/cityTextures.ts`
- `game/src/render/postFx.ts`
- `game/src/main.ts`
- `docs/licenses/graphics.md`
