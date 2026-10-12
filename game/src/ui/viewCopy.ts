/**
 * Short copy for the top-right of each stack / camera view:
 * what this view uses, and how it differs from the others.
 */

export type StackProfile = 'tesla' | 'waymo' | 'waabi';
export type CameraMode = 'chase' | 'hood' | 'bev' | 'orbit';

export interface ViewCopy {
  title: string;
  uses: string;
  diff: string;
}

export const STACK_VIEW_COPY: Record<StackProfile, ViewCopy & { rawLabel: string; percLabel: string }> = {
  tesla: {
    title: 'F1 · Tesla-style',
    uses: 'Cameras only. Depth is inferred from pixels, then turned into occupancy voxels. No lidar, no radar, no HD map. Lights and signs are read from the image.',
    diff: 'Waymo fuses lidar + radar + a prior map. Waabi predicts where space will be occupied in 1–3 s. This stack is vision end-to-end: cheaper sensors, weaker range and night depth.',
    rawLabel: 'Front camera (vision)',
    percLabel: 'Vision boxes + voxels',
  },
  waymo: {
    title: 'F2 · Waymo-style',
    uses: 'Lidar + radar + cameras, fused into labeled 3D boxes with track IDs. Localizes against an HD map (lanes, crosswalks, lights). Radar keeps velocity through rain and night.',
    diff: 'Tesla is cameras-only and has no map. Waabi scores future occupancy, not current boxes. This stack is multi-sensor + geofenced map: more redundant, only works where the map exists.',
    rawLabel: 'Ego camera (context)',
    percLabel: 'Fused lidar / radar boxes',
  },
  waabi: {
    title: 'F3 · Waabi-style',
    uses: 'Lidar, cameras, and radar fused into a bird’s-eye occupancy grid, plus 1 s / 2 s / 3 s future occupancy and a fan of scored trajectories. Mid-level reps stay readable.',
    diff: 'Tesla draws current vision boxes. Waymo draws fused tracks on a map. This stack asks “where will space be occupied?” and trains that in simulation (Sim World), not just “what is that object now?”',
    rawLabel: 'Ego camera (context)',
    percLabel: 'BEV occupancy-flow',
  },
};

export const CAMERA_VIEW_COPY: Record<CameraMode, ViewCopy> = {
  chase: {
    title: 'Chase camera',
    uses: 'Default rig: behind and slightly above the car, following the nose. It stays behind while you reverse. Hold right mouse to orbit; it eases home after 1.5 s. Scroll zooms.',
    diff: 'First person is the cabin: dash, windshield, and a wheel that turns with A and D. BEV is a straight-down map. Orbit stays free and does not auto-return.',
  },
  hood: {
    title: 'First person',
    uses: 'Left-hand seat, eye height about 1.2 m, looking down ~7°. A 36 cm wheel sits 0.6 m ahead, lower-left, and turns ~450° with A/D. Thin dash shelf, ambient strip, centre tablet on the dash, slim A-pillars into a thin roof header. The Kenney body and debug rays are hidden. Road fills the windshield.',
    diff: 'Chase follows from behind and can look around with RMB. BEV is top-down. Orbit is free around the car.',
  },
  bev: {
    title: 'BEV camera',
    uses: 'Bird’s-eye view straight down over the car — the same frame Waabi’s occupancy grid lives in.',
    diff: 'Chase and first person are perspective street views. Orbit can tilt and yaw freely. This one stays nadir.',
  },
  orbit: {
    title: 'Orbit camera',
    uses: 'Free look around the car. Right-drag yaws and pitches; scroll zooms. It does not snap back behind the car.',
    diff: 'Chase auto-returns behind the car after you release RMB. First person and BEV are locked framings.',
  },
};

export function aiViewTitle(profile: StackProfile): string {
  return `AI View — ${STACK_VIEW_COPY[profile].title}`;
}
