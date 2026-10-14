/**
 * View-mode benchmark: F1 / F2 / F3 subsystem times and optional Chrome FPS.
 *
 *   npm run bench:views
 *   npm run bench:views -- --browser
 *
 * The CPU path times what each stack adds on top of Simulation.step.
 * Legacy F3 (`runWaabiStack` with all static entities + a second roof lidar)
 * is reported as "before"; `tickWaabiView` is "after".
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { Simulation } from '../src/sim/simulation';
import { detectVisibleAgents } from '../src/stacks/tesla';
import {
  emptyWaabiState,
  f3WorkStats,
  makeFutureOccupancy,
  resetF3WorkStats,
  runWaabiStack,
  tickWaabiView,
} from '../src/stacks/waabi';
import { paintOccupancyPanelsToRgba } from '../src/render/bevOverlay';
import { simulateLidarScan, LIDAR_CONFIGS } from '../src/sensors/lidar';

function nowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

function stats(vals: number[]) {
  const mean = vals.reduce((a, b) => a + b, 0) / Math.max(1, vals.length);
  const max = vals.reduce((a, b) => Math.max(a, b), 0);
  return { meanMs: +mean.toFixed(3), maxMs: +max.toFixed(3), fpsEquiv: +(1000 / Math.max(mean, 0.001)).toFixed(1) };
}

async function cpuBench() {
  const sim = new Simulation({
    seed: 3,
    profile: 'baseline_lidar',
    environment: { timeOfDay: 'day', weather: 'clear', visibility: 1 },
    useOracle: false,
    maxDuration: 3600,
  });
  sim.beginParked();
  for (let i = 0; i < 12; i++) sim.step(1 / 30);

  const state0 = sim.getState();
  const counts = {
    staticEntities: state0.worldMap.staticEntities.length,
    traffic: state0.trafficVehicles.length,
    pedestrians: state0.pedestrians.length,
    lidarPoints: sim.getLidarPoints().length,
  };

  const N_WARM = 3;
  const N = 8;
  const buckets: Record<string, number[]> = {
    f1Vision: [],
    f2LidarBrowserLiteNearby: [],
    f3LegacyRunWaabiAllEntities: [],
    f3TickWaabiView: [],
    f3PaintRgba: [],
    roofLidarAllEntities: [],
  };

  let waabiLegacy = emptyWaabiState();
  const into = makeFutureOccupancy();
  const waabiFast = emptyWaabiState();

  for (let i = 0; i < N_WARM + N; i++) {
    sim.step(1 / 30);
    const state = sim.getState();
    const all = [
      ...state.worldMap.staticEntities,
      ...state.trafficVehicles,
      ...state.pedestrians,
    ];
    const dyn = [...state.trafficVehicles, ...state.pedestrians];
    const nearby = all.filter(e => {
      const dx = e.boundingBox.center.x - state.ego.transform.position.x;
      const dy = e.boundingBox.center.y - state.ego.transform.position.y;
      return dx * dx + dy * dy < 80 * 80;
    });

    let t0 = nowMs();
    detectVisibleAgents(state.ego, dyn);
    const tF1 = nowMs() - t0;

    t0 = nowMs();
    simulateLidarScan(
      LIDAR_CONFIGS['browserLite']!,
      state.ego,
      nearby,
      state.environment,
      state.timestamp,
      42,
    );
    const tF2 = nowMs() - t0;

    t0 = nowMs();
    simulateLidarScan(
      LIDAR_CONFIGS['roofLidar']!,
      state.ego,
      all,
      state.environment,
      state.timestamp,
      42,
    );
    const tRoof = nowMs() - t0;

    t0 = nowMs();
    const legacy = runWaabiStack(
      state.ego, all, state.environment, waabiLegacy, state.timestamp, 42, 10,
    );
    waabiLegacy = legacy.newState;
    const tLegacy = nowMs() - t0;

    t0 = nowMs();
    tickWaabiView(
      state.ego,
      [state.trafficVehicles, state.pedestrians],
      waabiFast,
      state.timestamp,
      42,
      into,
    );
    const tFast = nowMs() - t0;

    const pixels = new Uint8ClampedArray(320 * 200 * 4);
    t0 = nowMs();
    paintOccupancyPanelsToRgba(pixels, 320, 200, into);
    const tPaint = nowMs() - t0;

    if (i >= N_WARM) {
      buckets['f1Vision']!.push(tF1);
      buckets['f2LidarBrowserLiteNearby']!.push(tF2);
      buckets['f3LegacyRunWaabiAllEntities']!.push(tLegacy);
      buckets['f3TickWaabiView']!.push(tFast);
      buckets['f3PaintRgba']!.push(tPaint);
      buckets['roofLidarAllEntities']!.push(tRoof);
    }
  }

  const summary: Record<string, ReturnType<typeof stats>> = {};
  for (const [k, vals] of Object.entries(buckets)) summary[k] = stats(vals);

  const f1 = summary.f1Vision!.meanMs;
  const f3 = summary.f3TickWaabiView!.meanMs + summary.f3PaintRgba!.meanMs;
  const f3Legacy = summary.f3LegacyRunWaabiAllEntities!.meanMs;

  return {
    scene: counts,
    subsystems: summary,
    f3VsF1: {
      beforeExtraMs: +f3Legacy.toFixed(3),
      afterExtraMs: +f3.toFixed(3),
      afterWithin10pctOfF1: f3 <= f1 * 1.1 + 1.0,
      speedup: +(f3Legacy / Math.max(f3, 0.001)).toFixed(1),
    },
    work: { ...f3WorkStats },
  };
}

function chromePath(): string {
  return process.env.CHROME_PATH
    || '/usr/bin/google-chrome-stable';
}

interface CdpClient {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}

async function openCdp(wsUrl: string): Promise<CdpClient> {
  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (ev) => reject(ev));
  });
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data)) as { id?: number; result?: unknown; error?: { message: string } };
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id)!;
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    }
  });
  return {
    send(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      });
    },
    close() { ws.close(); },
  };
}

async function waitForHttp(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function measureViewFps(cdp: CdpClient, stack: 'tesla' | 'waymo' | 'waabi', frames = 90) {
  await cdp.send('Runtime.evaluate', {
    expression: `window.__autonomyDebug && window.__autonomyDebug.switchStack('${stack}')`,
    awaitPromise: false,
  });
  await new Promise(r => setTimeout(r, 400));
  const result = await cdp.send('Runtime.evaluate', {
    expression: `new Promise(resolve => {
      const times = [];
      let n = 0;
      let last = performance.now();
      function tick(t) {
        times.push(t - last);
        last = t;
        n++;
        if (n < ${frames}) requestAnimationFrame(tick);
        else {
          times.sort((a,b) => a-b);
          const mean = times.reduce((a,b)=>a+b,0) / times.length;
          const p95 = times[Math.floor(times.length * 0.95)];
          const work = window.__autonomyDebug.frameWork ? window.__autonomyDebug.frameWork() : {};
          resolve({ meanFrameMs: mean, p95FrameMs: p95, fps: 1000 / mean, hudFps: window.__autonomyDebug.getFps(), work });
        }
      }
      requestAnimationFrame(tick);
    })`,
    awaitPromise: true,
    returnByValue: true,
  }) as { result: { value: { meanFrameMs: number; p95FrameMs: number; fps: number; hudFps: number; work: Record<string, number> } } };
  return result.result.value;
}

async function browserBench(port: number) {
  const sizes = [
    { w: 1280, h: 720 },
  ] as const;
  const vite = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: new URL('..', import.meta.url).pathname,
    stdio: 'pipe',
  });
  const chromeProcs: ChildProcess[] = [];
  try {
    await waitForHttp(`http://127.0.0.1:${port}/`, 20000);
    const out: Record<string, unknown> = {};
    for (const size of sizes) {
      const dbgPort = 9222;
      const chrome = spawn(chromePath(), [
        '--headless=new',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        `--remote-debugging-port=${dbgPort}`,
        `--window-size=${size.w},${size.h}`,
        `http://127.0.0.1:${port}/?demo=lane`,
      ], { stdio: 'pipe' });
      chromeProcs.push(chrome);
      await waitForHttp(`http://127.0.0.1:${dbgPort}/json/version`, 15000);
      let pageWs = '';
      for (let i = 0; i < 50 && !pageWs; i++) {
        const list = await fetch(`http://127.0.0.1:${dbgPort}/json/list`).then(r => r.json()) as Array<{ type: string; webSocketDebuggerUrl?: string }>;
        const page = list.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
        if (page?.webSocketDebuggerUrl) pageWs = page.webSocketDebuggerUrl;
        else await new Promise(r => setTimeout(r, 200));
      }
      if (!pageWs) throw new Error('no Chrome page target');
      const cdp = await openCdp(pageWs);
      await cdp.send('Runtime.enable');
      await new Promise(r => setTimeout(r, 2500));
      const tesla = await measureViewFps(cdp, 'tesla');
      const waymo = await measureViewFps(cdp, 'waymo');
      const waabi = await measureViewFps(cdp, 'waabi');
      const key = `${size.w}x${size.h}`;
      out[key] = { tesla, waymo, waabi, f3Within10pctOfF1: waabi.fps >= tesla.fps * 0.9 };
      cdp.close();
      chrome.kill('SIGKILL');
    }
    return out;
  } finally {
    for (const p of chromeProcs) {
      try { p.kill('SIGKILL'); } catch { /* ignore */ }
    }
    vite.kill('SIGKILL');
  }
}

async function main() {
  const wantBrowser = process.argv.includes('--browser') || process.env.BENCH_BROWSER === '1';
  resetF3WorkStats();
  const cpu = await cpuBench();
  const report: Record<string, unknown> = { cpu };
  if (wantBrowser) {
    report.browser = await browserBench(4173);
  } else {
    report.browser = 'skipped (pass --browser to measure F1/F2/F3 FPS in Chrome)';
  }
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
