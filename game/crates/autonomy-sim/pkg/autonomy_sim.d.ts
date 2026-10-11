/* tslint:disable */
/* eslint-disable */

/**
 * Cast `n` rays from a shared origin against `m` yaw-aligned boxes.
 *
 * `dirs`: 3n floats (dx, dy, dz)
 * `boxes`: 7m floats (cx, cy, cz, sx, sy, sz, yaw)
 * Returns 2n floats: (t, entity_index) per ray. t < 0 means a miss.
 */
export function cast_rays(ox: number, oy: number, oz: number, dirs: Float32Array, boxes: Float32Array, max_range: number): Float32Array;

/**
 * Fill a square BEV occupancy grid. `centers` is 2k (x,y), `sizes` is 2k (sx,sy).
 */
export function fill_occupancy(resolution: number, extent: number, centers: Float32Array, sizes: Float32Array, values: Float32Array): Float32Array;

/**
 * Drop points below `z_thresh` (ground removal). Returns packed xyz of keepers.
 */
export function filter_ground(points: Float32Array, z_thresh: number): Float32Array;

/**
 * Bicycle-model step. Returns [x, y, yaw, vx, vy].
 */
export function step_vehicle(x: number, y: number, yaw: number, vx: number, vy: number, throttle: number, steering: number, brake: number, dt: number, wheelbase: number, max_speed: number, max_accel: number, max_decel: number): Float32Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly cast_rays: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly fill_occupancy: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number];
    readonly filter_ground: (a: number, b: number, c: number) => [number, number];
    readonly step_vehicle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number) => [number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
