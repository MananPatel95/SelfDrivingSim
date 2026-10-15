---
tags: [system, perception]
updated: 2026-10-15
sources: [2, 3, 14, 20, 34, 37]
---

# Perception F1 — Tesla-style

Cameras only. `detectVisibleAgents` keeps agents that fall in one of **eight** camera FOVs (forward, corners, sides, rear) after [[pr-14]]. Heavily occluded pedestrians are weaker, not dropped.

After [[pr-20]] the same FOV test also boxes nearby `stop_sign` and `yield_sign` entities. AI View draws those vision boxes (red / yellow class colours). The HUD detection count on Tesla must match that list (`hudDetectionCount`), not lidar tracks ([[ai-view]]).

There is no HD map and no radar on this stack.

The 3D overlay still snapshots vision detections at **10 Hz** ([[pr-34]]). Each display frame interpolates those snapshots and animates on the GPU ([[pr-37]]): eight camera frustums with a video-style sweep band, boxes that pop in with a confidence bar, occupancy-network voxels that rise/fall with inferred height, and pulsing vision rays to detections. There is **no lidar point cloud and no spinning beam** on F1.

## Public sources (educational stand-in)

This view is **not** Tesla software. It follows public Tesla Vision / Occupancy Network descriptions:

- Tesla Vision is cameras only (no lidar). Radar and ultrasonics were removed; Tesla said the occupancy network replaced ultrasonic inputs ([Electrek, 2022](https://electrek.co/2022/10/04/tesla-moving-away-ultrasonic-sensors-in-favor-tesla-vision/)).
- Occupancy Network: eight cameras → 3D occupied/free voxels, plus occupancy flow; object/lane heads are separate (Ashok Elluswamy, [CVPR 2022 AV workshop](https://gaussian37.github.io/autodrive-concept-tesla_cvpr_2022/); AI Day 2022). FSD release notes: occupancy from **video** not a single frame, velocity per voxel.
- Later FSD is also described as end-to-end camera video → controls ([Reuters, 2024](https://www.reuters.com/technology/tesla-gambles-black-box-ai-tech-robotaxis-2024-10-10/)). This overlay still shows occupancy + boxes because that is what Tesla published as a readable mid-level.

## Key files

- `game/src/stacks/tesla.ts`
- `game/src/stacks/tesla.test.ts`
- `game/src/render/perceptionViz.ts`
- `game/src/render/snapshotLerp.ts`
- `game/src/render/perceptionShaders.ts`
