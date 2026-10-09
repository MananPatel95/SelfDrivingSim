"""
Compare sensor modalities across profiles.
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List
import argparse


def run(args: argparse.Namespace) -> int:
    """Compare sensor modalities."""
    print(f"Comparing sensor modalities...")
    print(f"  Recordings: {args.recordings_dir}")
    print(f"  Output: {args.output}")
    
    recordings_dir = args.recordings_dir
    output_path = args.output
    
    if not recordings_dir.exists():
        print(f"Error: Recordings directory {recordings_dir} does not exist")
        return 1
    
    # Find recordings grouped by scenario seed
    recordings_by_seed: Dict[int, Dict[str, Path]] = {}
    
    for recording_dir in recordings_dir.iterdir():
        if not recording_dir.is_dir():
            continue
        
        manifest_path = recording_dir / 'manifest.json'
        if not manifest_path.exists():
            continue
        
        with open(manifest_path) as f:
            manifest = json.load(f)
        
        seed = manifest.get('scenarioSeed', 0)
        profile = manifest.get('profile', 'unknown')
        
        if seed not in recordings_by_seed:
            recordings_by_seed[seed] = {}
        recordings_by_seed[seed][profile] = recording_dir
    
    # Analyze each seed with multiple profiles
    comparison_results = []
    
    for seed, profiles in recordings_by_seed.items():
        if len(profiles) < 2:
            continue
        
        seed_comparison = {
            'seed': seed,
            'profiles': list(profiles.keys()),
            'metrics': {}
        }
        
        # Load frames from each profile
        profile_frames = {}
        for profile, path in profiles.items():
            frames_path = path / 'frames.json'
            if frames_path.exists():
                with open(frames_path) as f:
                    profile_frames[profile] = json.load(f)
        
        # Compare detection counts per frame
        for profile, frames in profile_frames.items():
            detection_counts = []
            fn_counts = []
            
            for frame in frames:
                detections = frame.get('perceptionOutput', {}).get('detections', [])
                detection_counts.append(len(detections))
                
                # Count false negatives (ground truth not detected)
                ground_truth = frame.get('groundTruth', [])
                dynamic_gt = [gt for gt in ground_truth if not gt.get('isStatic', False)]
                
                matched = 0
                for gt in dynamic_gt:
                    gt_pos = gt.get('boundingBox', {}).get('center', {})
                    for det in detections:
                        det_pos = det.get('boundingBox', {}).get('center', {})
                        dist = math.sqrt(
                            (gt_pos.get('x', 0) - det_pos.get('x', 0))**2 +
                            (gt_pos.get('y', 0) - det_pos.get('y', 0))**2
                        )
                        if dist < 2:
                            matched += 1
                            break
                
                fn_counts.append(len(dynamic_gt) - matched)
            
            seed_comparison['metrics'][profile] = {
                'avgDetections': sum(detection_counts) / len(detection_counts) if detection_counts else 0,
                'avgFalseNegatives': sum(fn_counts) / len(fn_counts) if fn_counts else 0,
                'frameCount': len(frames),
            }
        
        comparison_results.append(seed_comparison)
    
    # Generate comparison summary
    summary = {
        'totalSeeds': len(comparison_results),
        'comparisons': comparison_results,
        'profileSummary': {}
    }
    
    # Aggregate by profile
    profile_metrics: Dict[str, Dict[str, List[float]]] = {}
    for comp in comparison_results:
        for profile, metrics in comp['metrics'].items():
            if profile not in profile_metrics:
                profile_metrics[profile] = {'avgDetections': [], 'avgFalseNegatives': []}
            profile_metrics[profile]['avgDetections'].append(metrics['avgDetections'])
            profile_metrics[profile]['avgFalseNegatives'].append(metrics['avgFalseNegatives'])
    
    for profile, metrics in profile_metrics.items():
        summary['profileSummary'][profile] = {
            'meanDetections': sum(metrics['avgDetections']) / len(metrics['avgDetections']) if metrics['avgDetections'] else 0,
            'meanFalseNegatives': sum(metrics['avgFalseNegatives']) / len(metrics['avgFalseNegatives']) if metrics['avgFalseNegatives'] else 0,
        }
    
    # Save results
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nComparison complete!")
    print(f"  Compared {len(comparison_results)} scenarios with multiple profiles")
    
    print(f"\nProfile summary:")
    for profile, metrics in summary['profileSummary'].items():
        print(f"  {profile}: avg_det={metrics['meanDetections']:.1f}, avg_fn={metrics['meanFalseNegatives']:.1f}")
    
    print(f"\nOutput: {output_path}")
    
    return 0
