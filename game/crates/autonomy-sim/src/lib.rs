//! Hot-path simulation kernels compiled to WebAssembly.
//! Lidar ray/AABB tests, occupancy fill, vehicle kinematics, and
//! a cheap ground-removal pass used by perception pre-processing.

use wasm_bindgen::prelude::*;

/// Cast `n` rays from a shared origin against `m` yaw-aligned boxes.
///
/// `dirs`: 3n floats (dx, dy, dz)
/// `boxes`: 7m floats (cx, cy, cz, sx, sy, sz, yaw)
/// Returns 2n floats: (t, entity_index) per ray. t < 0 means a miss.
#[wasm_bindgen]
pub fn cast_rays(
    ox: f32,
    oy: f32,
    oz: f32,
    dirs: &[f32],
    boxes: &[f32],
    max_range: f32,
) -> Vec<f32> {
    let n = dirs.len() / 3;
    let m = boxes.len() / 7;
    let mut out = vec![-1.0_f32; n * 2];

    for i in 0..n {
        let dx = dirs[i * 3];
        let dy = dirs[i * 3 + 1];
        let dz = dirs[i * 3 + 2];
        let mut best_t = max_range;
        let mut best_idx = -1.0_f32;

        for j in 0..m {
            let cx = boxes[j * 7];
            let cy = boxes[j * 7 + 1];
            let cz = boxes[j * 7 + 2];
            let sx = boxes[j * 7 + 3] * 0.5;
            let sy = boxes[j * 7 + 4] * 0.5;
            let sz = boxes[j * 7 + 5] * 0.5;
            let yaw = boxes[j * 7 + 6];

            if let Some(t) = ray_aabb(ox, oy, oz, dx, dy, dz, cx, cy, cz, sx, sy, sz, yaw) {
                if t > 0.1 && t < best_t {
                    best_t = t;
                    best_idx = j as f32;
                }
            }
        }

        if best_idx >= 0.0 {
            out[i * 2] = best_t;
            out[i * 2 + 1] = best_idx;
        }
    }
    out
}

fn ray_aabb(
    ox: f32,
    oy: f32,
    oz: f32,
    dx: f32,
    dy: f32,
    dz: f32,
    cx: f32,
    cy: f32,
    cz: f32,
    hx: f32,
    hy: f32,
    hz: f32,
    yaw: f32,
) -> Option<f32> {
    let (s, c) = yaw.sin_cos();
    let px = ox - cx;
    let py = oy - cy;
    let pz = oz - cz;
    let lx = px * c + py * s;
    let ly = -px * s + py * c;
    let lz = pz;
    let ldx = dx * c + dy * s;
    let ldy = -dx * s + dy * c;
    let ldz = dz;

    let mut tmin = 0.0_f32;
    let mut tmax = f32::MAX;

    for (origin, dir, half) in [(lx, ldx, hx), (ly, ldy, hy), (lz, ldz, hz)] {
        if dir.abs() < 1e-8 {
            if origin < -half || origin > half {
                return None;
            }
        } else {
            let inv = 1.0 / dir;
            let mut t1 = (-half - origin) * inv;
            let mut t2 = (half - origin) * inv;
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            tmin = tmin.max(t1);
            tmax = tmax.min(t2);
            if tmin > tmax {
                return None;
            }
        }
    }
    if tmax < 0.0 {
        None
    } else if tmin > 0.0 {
        Some(tmin)
    } else {
        Some(tmax)
    }
}

/// Fill a square BEV occupancy grid. `centers` is 2k (x,y), `sizes` is 2k (sx,sy).
#[wasm_bindgen]
pub fn fill_occupancy(
    resolution: f32,
    extent: f32,
    centers: &[f32],
    sizes: &[f32],
    values: &[f32],
) -> Vec<f32> {
    let grid_size = ((extent * 2.0) / resolution).ceil() as usize;
    let mut grid = vec![0.0_f32; grid_size * grid_size];
    let n = centers.len() / 2;
    for i in 0..n {
        let cx = centers[i * 2];
        let cy = centers[i * 2 + 1];
        let hx = (sizes[i * 2] * 0.5 / resolution).ceil() as i32;
        let hy = (sizes[i * 2 + 1] * 0.5 / resolution).ceil() as i32;
        let gx = ((cx + extent) / resolution).floor() as i32;
        let gy = ((cy + extent) / resolution).floor() as i32;
        let val = values.get(i).copied().unwrap_or(1.0);
        for dy in -hy..=hy {
            for dx in -hx..=hx {
                let x = gx + dx;
                let y = gy + dy;
                if x >= 0 && y >= 0 && (x as usize) < grid_size && (y as usize) < grid_size {
                    let idx = y as usize * grid_size + x as usize;
                    if val > grid[idx] {
                        grid[idx] = val;
                    }
                }
            }
        }
    }
    grid
}

/// Bicycle-model step. Returns [x, y, yaw, vx, vy].
#[wasm_bindgen]
pub fn step_vehicle(
    x: f32,
    y: f32,
    yaw: f32,
    vx: f32,
    vy: f32,
    throttle: f32,
    steering: f32,
    brake: f32,
    dt: f32,
    wheelbase: f32,
    max_speed: f32,
    max_accel: f32,
    max_decel: f32,
) -> Vec<f32> {
    let speed = (vx * vx + vy * vy).sqrt();
    let forward = vx * yaw.cos() + vy * yaw.sin();
    let signed = if speed > 0.05 {
        speed * forward.signum()
    } else {
        0.0
    };
    let accel = if brake > 0.0 {
        -max_decel * brake
    } else {
        throttle * max_accel
    };
    let mut new_speed = (signed + accel * dt).clamp(-max_speed * 0.3, max_speed);
    if new_speed.abs() < 0.1 && throttle.abs() < 0.1 {
        new_speed = 0.0;
    }
    let steer_angle = steering * std::f32::consts::FRAC_PI_6;
    let yaw_rate = if new_speed.abs() > 0.1 {
        (new_speed / wheelbase) * steer_angle.tan()
    } else {
        0.0
    };
    let new_yaw = yaw + yaw_rate * dt;
    let nvx = new_speed * new_yaw.cos();
    let nvy = new_speed * new_yaw.sin();
    vec![x + nvx * dt, y + nvy * dt, new_yaw, nvx, nvy]
}

/// Drop points below `z_thresh` (ground removal). Returns packed xyz of keepers.
#[wasm_bindgen]
pub fn filter_ground(points: &[f32], z_thresh: f32) -> Vec<f32> {
    let mut out = Vec::with_capacity(points.len());
    let n = points.len() / 3;
    for i in 0..n {
        let z = points[i * 3 + 2];
        if z >= z_thresh {
            out.push(points[i * 3]);
            out.push(points[i * 3 + 1]);
            out.push(z);
        }
    }
    out
}
