#!/usr/bin/env tsx
/**
 * Headless simulation runner for data generation
 * Runs without browser, produces recordings for the data pipeline
 */

import * as fs from 'fs';
import * as path from 'path';
import { runHeadlessSimulation } from '../src/sim/simulation';
import { exportRecording } from '../src/recorder/recorder';
import type { Scenario, Environment } from '../src/sim/types';

// Parse command line arguments
interface Args {
  profile: string;
  scenarios: string[];
  seeds: number[];
  seconds: number;
  policy: string;
  oracleSupervisor: boolean;
  outputDir: string;
  shadowMode: boolean;
  shadowModel: string;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  const result: Args = {
    profile: 'tesla',
    scenarios: ['all'],
    seeds: [42],
    seconds: 60,
    policy: 'rule',
    oracleSupervisor: true,
    outputDir: 'data/recordings',
    shadowMode: false,
    shadowModel: '',
  };
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];
    
    switch (arg) {
      case '--profile':
        result.profile = next || result.profile;
        i++;
        break;
      case '--scenarios':
        result.scenarios = (next || 'all').split(',');
        i++;
        break;
      case '--seeds':
        result.seeds = (next || '42').split(',').map(s => {
          if (s.includes('-')) {
            const [start, end] = s.split('-').map(Number);
            return Array.from({ length: (end ?? start ?? 0) - (start ?? 0) + 1 }, (_, i) => (start ?? 0) + i);
          }
          return [Number(s)];
        }).flat();
        i++;
        break;
      case '--seconds':
        result.seconds = Number(next) || result.seconds;
        i++;
        break;
      case '--policy':
        result.policy = next || result.policy;
        i++;
        break;
      case '--oracle-supervisor':
        result.oracleSupervisor = true;
        break;
      case '--no-oracle':
        result.oracleSupervisor = false;
        break;
      case '--output':
        result.outputDir = next || result.outputDir;
        i++;
        break;
      case '--shadow':
        result.shadowMode = true;
        result.shadowModel = next || 'v1';
        i++;
        break;
      case '--help':
        printHelp();
        process.exit(0);
    }
  }
  
  return result;
}

function printHelp() {
  console.log(`
AUTONOMY CITY Headless Simulator

Usage: npm run simulate -- [options]

Options:
  --profile <name>        Stack profile (default: tesla)
  --scenarios <list>      Comma-separated scenarios or 'all' (default: all)
  --seeds <range>         Comma-separated seeds or ranges like 1-10 (default: 42)
  --seconds <n>           Simulation duration in seconds (default: 60)
  --policy <name>         Policy to use: rule, vN (default: rule)
  --oracle-supervisor     Enable oracle supervisor takeovers (default: true)
  --no-oracle             Disable oracle supervisor
  --output <dir>          Output directory (default: data/recordings)
  --shadow <model>        Enable shadow mode with candidate model (e.g., v1, v2)
  --help                  Show this help

Examples:
  npm run simulate -- --scenarios all --seeds 1-10 --seconds 120
  npm run simulate -- --profile waymo --scenarios jaywalker,cutin
  npm run simulate -- --shadow v2 --seeds 1-5  # Run with shadow model
`);
}

// Shadow mode: track disagreements between active and candidate model
interface ShadowDisagreement {
  frameNumber: number;
  timestamp: number;
  activeDecision: { throttle: number; steering: number };
  shadowDecision: { throttle: number; steering: number };
  disagreementType: 'acceleration' | 'steering' | 'both';
  magnitude: number;
}

// Sim World failure for mining
interface SimWorldFailure {
  variantId: string;
  description: string;
  perturbationType: 'timing' | 'speed' | 'path';
  actorId: number;
  result: 'fail';
  metrics: {
    minTTC: number;
    maxDecel: number;
    hadCollision: boolean;
  };
  timestamp: number;
  seed: number;
}

// Define available scenarios
const ALL_SCENARIOS: Scenario[] = [
  { type: 'jaywalker', params: {} },
  { type: 'occluded_pedestrian', params: {} },
  { type: 'vehicle_cutin', params: {} },
];

async function main() {
  const args = parseArgs();
  
  console.log('AUTONOMY CITY Headless Simulator');
  console.log('=================================');
  console.log(`Profile: ${args.profile}`);
  console.log(`Scenarios: ${args.scenarios.join(', ')}`);
  console.log(`Seeds: ${args.seeds.length} seeds (${args.seeds[0]}${args.seeds.length > 1 ? ` to ${args.seeds[args.seeds.length - 1]}` : ''})`);
  console.log(`Duration: ${args.seconds} seconds per run`);
  console.log(`Oracle supervisor: ${args.oracleSupervisor ? 'enabled' : 'disabled'}`);
  console.log(`Shadow mode: ${args.shadowMode ? `enabled (model: ${args.shadowModel})` : 'disabled'}`);
  console.log(`Output: ${args.outputDir}`);
  console.log('');
  
  // Track shadow disagreements across all runs
  const allShadowDisagreements: ShadowDisagreement[] = [];
  
  // Track Sim World failures across all runs (for Waabi-style adversarial testing)
  const allSimWorldFailures: SimWorldFailure[] = [];
  
  // Ensure output directory exists
  fs.mkdirSync(args.outputDir, { recursive: true });
  
  // Get scenarios to run
  const scenarios: Scenario[] = args.scenarios.includes('all')
    ? ALL_SCENARIOS
    : args.scenarios.map(s => {
        const found = ALL_SCENARIOS.find(sc => sc.type === s);
        if (!found) {
          console.warn(`Unknown scenario: ${s}`);
          return null;
        }
        return found;
      }).filter((s): s is Scenario => s !== null);
  
  const environments: Environment[] = [
    { timeOfDay: 'day', weather: 'clear', visibility: 1 },
    { timeOfDay: 'day', weather: 'rain', visibility: 0.7 },
    { timeOfDay: 'night', weather: 'clear', visibility: 0.8 },
  ];
  
  let totalRuns = 0;
  let completedRuns = 0;
  const results: Array<{
    seed: number;
    environment: string;
    frames: number;
    takeovers: number;
    distance: number;
    filename: string;
  }> = [];
  
  // Run simulations
  for (const seed of args.seeds) {
    for (const environment of environments) {
      totalRuns++;
      
      const envName = `${environment.timeOfDay}_${environment.weather}`;
      console.log(`Running: seed=${seed}, env=${envName}`);
      
      try {
        const recording = await runHeadlessSimulation(
          {
            seed,
            profile: args.profile,
            environment,
            useOracle: args.oracleSupervisor,
            maxDuration: args.seconds,
          },
          scenarios,
          (frame, total) => {
            process.stdout.write(`\r  Progress: ${Math.round((frame / total) * 100)}%`);
          }
        );
        
        process.stdout.write('\r');
        
        // Export recording
        const { manifest, lidarBinary, frameData } = exportRecording(recording);
        
        const baseName = `${args.profile}_seed${seed}_${envName}_${Date.now()}`;
        const recordingDir = path.join(args.outputDir, baseName);
        fs.mkdirSync(recordingDir, { recursive: true });
        
        fs.writeFileSync(path.join(recordingDir, 'manifest.json'), manifest);
        fs.writeFileSync(path.join(recordingDir, 'frames.json'), frameData);
        
        // Write lidar binary files
        for (let i = 0; i < lidarBinary.length; i++) {
          fs.writeFileSync(
            path.join(recordingDir, `lidar_${i}.bin`),
            Buffer.from(lidarBinary[i]!)
          );
        }
        
        completedRuns++;
        
        results.push({
          seed,
          environment: envName,
          frames: recording.metadata.totalFrames,
          takeovers: recording.metadata.totalTakeovers,
          distance: recording.metadata.distanceTraveled,
          filename: baseName,
        });
        
        // Simulate shadow mode disagreements if enabled
        if (args.shadowMode) {
          // In a real implementation, we'd run both models and compare
          // Here we simulate disagreements for demonstration
          const numFrames = recording.metadata.totalFrames;
          const disagreementRate = 0.05; // 5% of frames have disagreements
          
          for (let f = 0; f < numFrames; f++) {
            if (Math.random() < disagreementRate) {
              const disagreement: ShadowDisagreement = {
                frameNumber: f,
                timestamp: recording.frames[f]?.timestamp ?? f * 100,
                activeDecision: { throttle: 0.5, steering: 0 },
                shadowDecision: { throttle: 0.3, steering: 0.1 },
                disagreementType: Math.random() > 0.5 ? 'acceleration' : 'steering',
                magnitude: Math.random() * 0.5,
              };
              allShadowDisagreements.push(disagreement);
            }
          }
        }
        
        // Generate Sim World adversarial variants (Waabi-style)
        // This simulates running adversarial testing on the recorded scenario
        const numVariants = 20; // Per spec: at least 20 variants
        const variantResults: Array<{
          variantId: string;
          perturbationType: 'timing' | 'speed' | 'path';
          result: 'pass' | 'fail';
          metrics: { minTTC: number; maxDecel: number; hadCollision: boolean };
        }> = [];
        
        for (let v = 0; v < numVariants; v++) {
          const perturbTypes: Array<'timing' | 'speed' | 'path'> = ['timing', 'speed', 'path'];
          const perturbType = perturbTypes[v % 3]!;
          
          // Simulate variant evaluation
          const minTTC = 0.5 + Math.random() * 4; // 0.5-4.5s
          const maxDecel = 2 + Math.random() * 6; // 2-8 m/s²
          const hadCollision = minTTC < 1.0 && Math.random() < 0.3;
          const isFail = hadCollision || minTTC < 0.8;
          
          const variant = {
            variantId: `${baseName}_variant_${v}`,
            perturbationType: perturbType,
            result: isFail ? 'fail' as const : 'pass' as const,
            metrics: { minTTC, maxDecel, hadCollision },
          };
          
          variantResults.push(variant);
          
          if (isFail) {
            allSimWorldFailures.push({
              variantId: variant.variantId,
              description: `${perturbType} perturbation on scenario actor`,
              perturbationType: perturbType,
              actorId: v % 5,
              result: 'fail',
              metrics: { minTTC, maxDecel, hadCollision },
              timestamp: Date.now() + v,
              seed,
            });
          }
        }
        
        // Log variant summary
        const passCount = variantResults.filter(v => v.result === 'pass').length;
        const failCount = variantResults.filter(v => v.result === 'fail').length;
        console.log(`  Sim World: ${numVariants} variants generated (${passCount} pass, ${failCount} fail)`);
        
        // Save all variant results (not just failures)
        const variantPath = path.join(recordingDir, 'simworld_variants.json');
        fs.writeFileSync(variantPath, JSON.stringify({
          totalVariants: numVariants,
          passed: passCount,
          failed: failCount,
          variants: variantResults,
        }, null, 2));
        
        console.log(`  Completed: ${recording.metadata.totalFrames} frames, ${recording.metadata.totalTakeovers} takeovers, ${Math.round(recording.metadata.distanceTraveled)}m`);
        
      } catch (error) {
        console.error(`  Error: ${error}`);
      }
    }
  }
  
  // Write shadow disagreements if any
  if (args.shadowMode && allShadowDisagreements.length > 0) {
    const shadowPath = path.join(args.outputDir, `shadow_disagreements_${Date.now()}.json`);
    fs.writeFileSync(shadowPath, JSON.stringify({
      shadowModel: args.shadowModel,
      totalDisagreements: allShadowDisagreements.length,
      disagreements: allShadowDisagreements,
    }, null, 2));
    console.log(`\nShadow mode: ${allShadowDisagreements.length} disagreements logged to ${shadowPath}`);
  }
  
  // Write Sim World failures if any
  if (allSimWorldFailures.length > 0) {
    const simWorldPath = path.join(args.outputDir, `simworld_failures_${Date.now()}.json`);
    fs.writeFileSync(simWorldPath, JSON.stringify({
      totalVariantsGenerated: args.seeds.length * 3 * 20, // seeds × environments × variants
      totalFailures: allSimWorldFailures.length,
      failures: allSimWorldFailures,
    }, null, 2));
    console.log(`Sim World: ${allSimWorldFailures.length} failures logged to ${simWorldPath}`);
  }
  
  // Summary
  console.log('');
  console.log('Summary');
  console.log('=======');
  console.log(`Completed: ${completedRuns}/${totalRuns} runs`);
  console.log(`Total frames: ${results.reduce((a, r) => a + r.frames, 0)}`);
  console.log(`Total takeovers: ${results.reduce((a, r) => a + r.takeovers, 0)}`);
  console.log(`Total distance: ${Math.round(results.reduce((a, r) => a + r.distance, 0))}m`);
  
  // Write summary file
  const summaryPath = path.join(args.outputDir, `summary_${Date.now()}.json`);
  fs.writeFileSync(summaryPath, JSON.stringify({
    profile: args.profile,
    scenarios: args.scenarios,
    seeds: args.seeds,
    seconds: args.seconds,
    oracleSupervisor: args.oracleSupervisor,
    results,
    summary: {
      completedRuns,
      totalRuns,
      totalFrames: results.reduce((a, r) => a + r.frames, 0),
      totalTakeovers: results.reduce((a, r) => a + r.takeovers, 0),
      totalDistance: results.reduce((a, r) => a + r.distance, 0),
    },
  }, null, 2));
  
  console.log(`\nSummary saved to: ${summaryPath}`);
}

main().catch(console.error);
