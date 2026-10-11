/**
 * Optional Rust/WASM hot path. Falls back to TypeScript if the crate
 * was not built (`make wasm` / `make install`).
 */

export interface WasmKernels {
  available: boolean;
  castRays(
    ox: number,
    oy: number,
    oz: number,
    dirs: Float32Array,
    boxes: Float32Array,
    maxRange: number
  ): Float32Array;
  fillOccupancy(
    resolution: number,
    extent: number,
    centers: Float32Array,
    sizes: Float32Array,
    values: Float32Array
  ): Float32Array;
  stepVehicle(args: {
    x: number; y: number; yaw: number; vx: number; vy: number;
    throttle: number; steering: number; brake: number; dt: number;
    wheelbase: number; maxSpeed: number; maxAccel: number; maxDecel: number;
  }): Float32Array;
  filterGround(points: Float32Array, zThresh: number): Float32Array;
}

const tsFallback: WasmKernels = {
  available: false,
  castRays(ox, oy, oz, dirs, boxes, maxRange) {
    const n = dirs.length / 3;
    const m = boxes.length / 7;
    const out = new Float32Array(n * 2);
    out.fill(-1);
    for (let i = 0; i < n; i++) {
      const dx = dirs[i * 3]!;
      const dy = dirs[i * 3 + 1]!;
      const dz = dirs[i * 3 + 2]!;
      let bestT = maxRange;
      let bestIdx = -1;
      for (let j = 0; j < m; j++) {
        const t = rayAabb(
          ox, oy, oz, dx, dy, dz,
          boxes[j * 7]!, boxes[j * 7 + 1]!, boxes[j * 7 + 2]!,
          boxes[j * 7 + 3]! * 0.5, boxes[j * 7 + 4]! * 0.5, boxes[j * 7 + 5]! * 0.5,
          boxes[j * 7 + 6]!
        );
        if (t !== null && t > 0.1 && t < bestT) {
          bestT = t;
          bestIdx = j;
        }
      }
      if (bestIdx >= 0) {
        out[i * 2] = bestT;
        out[i * 2 + 1] = bestIdx;
      }
    }
    return out;
  },
  fillOccupancy(resolution, extent, centers, sizes, values) {
    const gridSize = Math.ceil((extent * 2) / resolution);
    const grid = new Float32Array(gridSize * gridSize);
    const n = centers.length / 2;
    for (let i = 0; i < n; i++) {
      const gx = Math.floor((centers[i * 2]! + extent) / resolution);
      const gy = Math.floor((centers[i * 2 + 1]! + extent) / resolution);
      const hx = Math.ceil(sizes[i * 2]! / 2 / resolution);
      const hy = Math.ceil(sizes[i * 2 + 1]! / 2 / resolution);
      const val = values[i] ?? 1;
      for (let dy = -hy; dy <= hy; dy++) {
        for (let dx = -hx; dx <= hx; dx++) {
          const x = gx + dx;
          const y = gy + dy;
          if (x >= 0 && y >= 0 && x < gridSize && y < gridSize) {
            const idx = y * gridSize + x;
            if (val > (grid[idx] ?? 0)) grid[idx] = val;
          }
        }
      }
    }
    return grid;
  },
  stepVehicle(a) {
    const speed = Math.hypot(a.vx, a.vy);
    const forward = a.vx * Math.cos(a.yaw) + a.vy * Math.sin(a.yaw);
    let signed = speed > 0.05 ? speed * Math.sign(forward || 1) : 0;
    const accel = a.brake > 0 ? -a.maxDecel * a.brake : a.throttle * a.maxAccel;
    let newSpeed = signed + accel * a.dt;
    newSpeed = Math.max(-a.maxSpeed * 0.3, Math.min(a.maxSpeed, newSpeed));
    if (Math.abs(newSpeed) < 0.1 && Math.abs(a.throttle) < 0.1) newSpeed = 0;
    const steer = a.steering * (Math.PI / 6);
    const yawRate = Math.abs(newSpeed) > 0.1 ? (newSpeed / a.wheelbase) * Math.tan(steer) : 0;
    const yaw = a.yaw + yawRate * a.dt;
    const vx = newSpeed * Math.cos(yaw);
    const vy = newSpeed * Math.sin(yaw);
    return new Float32Array([a.x + vx * a.dt, a.y + vy * a.dt, yaw, vx, vy]);
  },
  filterGround(points, zThresh) {
    const keep: number[] = [];
    for (let i = 0; i < points.length; i += 3) {
      if ((points[i + 2] ?? 0) >= zThresh) {
        keep.push(points[i]!, points[i + 1]!, points[i + 2]!);
      }
    }
    return new Float32Array(keep);
  },
};

function rayAabb(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  cx: number, cy: number, cz: number,
  hx: number, hy: number, hz: number,
  yaw: number
): number | null {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const lx = px * c + py * s;
  const ly = -px * s + py * c;
  const lz = pz;
  const ldx = dx * c + dy * s;
  const ldy = -dx * s + dy * c;
  const ldz = dz;
  let tmin = 0;
  let tmax = Infinity;
  const axes: Array<[number, number, number]> = [[lx, ldx, hx], [ly, ldy, hy], [lz, ldz, hz]];
  for (const [origin, dir, half] of axes) {
    if (Math.abs(dir) < 1e-8) {
      if (origin < -half || origin > half) return null;
    } else {
      const inv = 1 / dir;
      let t1 = (-half - origin) * inv;
      let t2 = (half - origin) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  if (tmax < 0) return null;
  return tmin > 0 ? tmin : tmax;
}

let kernels: WasmKernels = tsFallback;
let loadPromise: Promise<WasmKernels> | null = null;

export function getWasmKernels(): WasmKernels {
  return kernels;
}

export async function loadWasmKernels(): Promise<WasmKernels> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      // Built by `make wasm`. Missing pkg is the supported fallback path.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod: any = await import(
        /* @vite-ignore */ '../../crates/autonomy-sim/pkg/autonomy_sim.js'
      );
      if (mod.default) await mod.default();
      const probe = Float32Array.from(
        mod.cast_rays(0, 0, 0, new Float32Array([1, 0, 0]), new Float32Array([5, 0, 0, 2, 2, 2, 0]), 20)
      );
      if (!(probe.length >= 2 && (probe[0] ?? 0) > 0)) {
        throw new Error('stub wasm module');
      }
      kernels = {
        available: true,
        castRays: (ox, oy, oz, dirs, boxes, maxRange) =>
          Float32Array.from(mod.cast_rays(ox, oy, oz, dirs, boxes, maxRange)),
        fillOccupancy: (resolution, extent, centers, sizes, values) =>
          Float32Array.from(mod.fill_occupancy(resolution, extent, centers, sizes, values)),
        stepVehicle: (a) =>
          Float32Array.from(mod.step_vehicle(
            a.x, a.y, a.yaw, a.vx, a.vy, a.throttle, a.steering, a.brake, a.dt,
            a.wheelbase, a.maxSpeed, a.maxAccel, a.maxDecel
          )),
        filterGround: (points, zThresh) => Float32Array.from(mod.filter_ground(points, zThresh)),
      };
      console.log('[autonomy-sim] Rust/WASM kernels loaded');
    } catch {
      kernels = tsFallback;
      console.log('[autonomy-sim] WASM not built, using TypeScript fallback');
    }
    return kernels;
  })();
  return loadPromise;
}
