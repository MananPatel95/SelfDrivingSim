/**
 * Short copy for the top-right of each stack / camera view:
 * a one-line summary on the card, longer uses/diff in the ? popover.
 */

export type StackProfile = 'tesla' | 'waymo' | 'waabi';
export type CameraMode = 'chase' | 'hood' | 'bev' | 'orbit';
export type PanelHelpId = 'explainer' | 'ai-view' | 'info' | 'bev';

export interface ViewCopy {
  title: string;
  /** One-line “what this stack uses” for the compact view-info card. */
  summary?: string;
  uses: string;
  diff: string;
}

export const STACK_VIEW_COPY: Record<StackProfile, ViewCopy & { rawLabel: string; percLabel: string }> = {
  tesla: {
    title: 'F1 · Tesla-style',
    summary: 'Cameras only → occupancy voxels from pixels',
    uses: 'Cameras only. Depth is inferred from pixels, then turned into occupancy voxels. No lidar, no radar, no HD map. Lights and signs are read from the image.',
    diff: 'Waymo fuses lidar + radar + a prior map. Waabi predicts where space will be occupied in 1–3 s. This stack is vision end-to-end: cheaper sensors, weaker range and night depth.',
    rawLabel: 'Front camera (vision)',
    percLabel: 'Vision boxes + voxels',
  },
  waymo: {
    title: 'F2 · Waymo-style',
    summary: 'Lidar + radar + cameras → 3D boxes on an HD map',
    uses: 'Lidar + radar + cameras, fused into labeled 3D boxes with track IDs. Localizes against an HD map (lanes, crosswalks, lights). Radar keeps velocity through rain and night.',
    diff: 'Tesla is cameras-only and has no map. Waabi scores future occupancy, not current boxes. This stack is multi-sensor + geofenced map: more redundant, only works where the map exists.',
    rawLabel: 'Ego camera (context)',
    percLabel: 'Fused lidar / radar boxes',
  },
  waabi: {
    title: 'F3 · Waabi-style',
    summary: 'Lidar + camera + radar → occupancy grid + 1–3 s forecast',
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
    uses: 'Left-hand seat, eye height about 1.2 m, 88° FOV looking down ~11°. A 36 cm wheel sits 0.6 m ahead, lower-left, and turns ~450° with A/D. Solid dark dash fills the lower ~30% of the frame edge to edge, with a bevelled top and a full-width orange strip. Landscape tablet inset to the right of the wheel. No A-pillars or roof header. The Kenney body and debug rays are hidden. Road fills the windshield.',
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
  const short = STACK_VIEW_COPY[profile].title.split('·')[0]!.trim();
  return `AI View · ${short}`;
}

export function panelHelpCopy(
  id: PanelHelpId,
  stack: StackProfile,
  camera: CameraMode,
): { title: string; body: string } {
  const s = STACK_VIEW_COPY[stack];
  const cam = CAMERA_VIEW_COPY[camera];
  if (id === 'explainer') {
    return {
      title: s.title,
      body: [
        `Uses: ${s.uses}`,
        `Unlike the others: ${s.diff}`,
        `${cam.title}: ${cam.uses}`,
        `Unlike the other cameras: ${cam.diff}`,
      ].join('\n\n'),
    };
  }
  if (id === 'ai-view') {
    const how: Record<StackProfile, string> = {
      tesla: 'Left inset is the raw front camera (click it for first person). Right inset draws vision boxes: magenta = pedestrians, green = cars and stop/yield signs. Cyan voxels in the world are occupied cells inferred from pixels — there is no lidar cloud.',
      waymo: 'Left inset is the ego camera for context. Right inset draws fused lidar/radar boxes with track IDs on the HD map. These are current object tracks, not a future occupancy forecast.',
      waabi: 'Left inset is the ego camera. Right inset is a 2D bird’s-eye occupancy map (same idea as the bigger Waabi BEV panel): warm cells are occupied, the cyan dot is you.',
    };
    return {
      title: aiViewTitle(stack),
      body: [
        how[stack],
        `This panel shows ${s.percLabel.toLowerCase()}. V hides the panel. G overlays ground-truth misses (red = missed, orange = extra).`,
      ].join('\n\n'),
    };
  }
  if (id === 'bev') {
    return {
      title: 'Waabi BEV + Sim World',
      body: [
        'Top row is bird’s-eye occupancy. Current is now. +1s / +2s / +3s are where the stack thinks space will be occupied. Heat is blue (low) → red (high). The cyan dot is the ego car.',
        'The lower fan is scored trajectories: orange = candidates, green = the chosen path.',
        'The table is Sim World — adversarial variants (timing / speed / path). ✓ passed, ✗ failed. TTC is time-to-collision; amber under 2 s is tight.',
        'World boxes are current tracks. Cyan voxels are occupied cells in the same BEV frame.',
      ].join('\n\n'),
    };
  }
  return {
    title: 'Stack info',
    body: [
      'I toggles this card. It is the longer baseline for the active stack: sensors, internal representation, strengths, weaknesses, and a real-world example.',
      s.uses,
    ].join('\n\n'),
  };
}
