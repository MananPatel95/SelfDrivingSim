---
tags: [system]
updated: 2026-10-12
sources: [3, 5, 12]
---

# Collisions

Ego vs world is a 2D impulse solver on mesh-matched colliders (`collision.ts`). A uniform **spatial hash** (8 m cells) is the broadphase so SAT / circle tests only run on nearby props. Curbs stay paint-only ([[pr-12]]); lidar `cast_rays` stays in Rust/WASM.

## Colliders

- **Ego sedan:** OBB 4.78 × 1.93 m (Kenney sedan 4.7 × 1.85 plus a 4 cm skin).
- **NPC cars:** OBB 4.4 × 1.8 m (box body 4.2 × 1.6 plus wheels).
- **Trucks:** OBB from the entity box (~8 × 2.5 m).
- **Poles / trees / pedestrians:** upright capsules (circles in 2D) with radii 0.12 / 0.30 / 0.28 m, matching the cylinder / torso meshes.
- **Stop / yield signs:** thin OBB (0.24 × 1.04 m) facing traffic.

A swept circle along the last ego step catches thin poles that a 30 Hz step would otherwise tunnel through. `updateVehicle`, `removeGround`, and `createBEVOccupancyFromAgents` are unchanged; nothing imports `simHotPath.ts`.

## Response

Car-to-car (and parked cars) uses mass, inertia, and restitution. The impulse conserves linear momentum, applies Coulomb friction, and adds yaw rate from an off-centre contact so both cars spin. The traffic car is shoved (`impactCooldown` free-body slide) instead of only being position-separated.

Buildings and trees are infinite-mass walls. Poles and signs are solid when the closing / ego speed is below `SNAP_SPEED` (6 m/s, ~22 km/h). Faster hits snap them: a hard impulse slows the ego, then the prop falls over (~0.4 s) and its collider is disabled once it is on the ground.

Pedestrians are light (75 kg). A hit knocks them back into `state: 'tumbling'` (pitch/roll + limb flail) and appends the event to `collisionLog`.

A contact-id set plus a 450 ms hold counts **one collision per object**, not one per frame. A counted hit increments the HUD counter and, if the stack was on autopilot, calls `takeover('collision')`.

## Key files

- `game/src/sim/collision.ts`
- `game/src/sim/collision.test.ts`
- `game/src/sim/collisionSim.test.ts`
- `game/src/sim/simulation.ts`
- `game/src/sim/world.ts`
- `game/src/main.ts`
