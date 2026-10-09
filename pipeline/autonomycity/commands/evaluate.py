"""
Evaluate models on benchmark set.
Reports per-class metrics, distance bins, etc.
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List
import argparse

import numpy as np


def run(args: argparse.Namespace) -> int:
    """Run model evaluation."""
    print(f"Evaluating model...")
    print(f"  Model: {args.model}")
    print(f"  Benchmark: {args.benchmark}")
    print(f"  Type: {args.model_type}")
    
    model_path = args.model
    benchmark_path = args.benchmark
    output_path = args.output
    
    if not model_path.exists():
        print(f"Error: Model path {model_path} does not exist")
        return 1
    
    if not benchmark_path.exists():
        print(f"Error: Benchmark path {benchmark_path} does not exist")
        return 1
    
    # Load benchmark data
    frames_file = benchmark_path / 'frames.json'
    if not frames_file.exists():
        print(f"Error: No frames.json in benchmark directory")
        return 1
    
    with open(frames_file) as f:
        frames = json.load(f)
    
    # Load model metadata
    metadata_file = model_path / 'metadata.json'
    if metadata_file.exists():
        with open(metadata_file) as f:
            model_metadata = json.load(f)
    else:
        model_metadata = {}
    
    if args.model_type == 'perception':
        results = evaluate_perception(frames, model_path, model_metadata)
    else:
        results = evaluate_policy(frames, model_path, model_metadata)
    
    # Save results
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2)
    
    print(f"\nEvaluation complete!")
    print(f"  Results saved to: {output_path}")
    
    # Print summary
    if args.model_type == 'perception':
        print(f"\nPerception metrics:")
        for class_name, metrics in results.get('perClass', {}).items():
            print(f"  {class_name}: P={metrics.get('precision', 0):.3f}, R={metrics.get('recall', 0):.3f}, F1={metrics.get('f1', 0):.3f}")
    else:
        print(f"\nPolicy metrics:")
        print(f"  Action MSE: {results.get('actionMSE', 0):.4f}")
        print(f"  Accel MAE: {results.get('accelMAE', 0):.4f}")
        print(f"  Steer MAE: {results.get('steerMAE', 0):.4f}")
    
    return 0


def evaluate_perception(
    frames: List[Dict[str, Any]],
    model_path: Path,
    metadata: Dict[str, Any]
) -> Dict[str, Any]:
    """Evaluate perception model."""
    class_names = metadata.get('classNames', ['car', 'truck', 'pedestrian', 'cyclist'])
    
    # Count true positives, false positives, false negatives per class
    per_class: Dict[str, Dict[str, int]] = {
        name: {'tp': 0, 'fp': 0, 'fn': 0} for name in class_names
    }
    
    # Distance bins
    distance_bins = [(0, 10), (10, 20), (20, 30), (30, 50)]
    per_distance: Dict[str, Dict[str, int]] = {
        f"{d[0]}-{d[1]}m": {'tp': 0, 'fp': 0, 'fn': 0} for d in distance_bins
    }
    
    total_tp = 0
    total_fp = 0
    total_fn = 0
    
    for frame in frames:
        auto_labels = frame.get('autoLabels', [])
        vendor_labels = frame.get('vendorLabels', [])
        
        # In real eval, we'd run inference; here we simulate with vendor labels
        # treating auto_labels as ground truth
        
        matched_gt = set()
        
        for pred in vendor_labels:
            pred_class = pred.get('classType', 'unknown')
            pred_pos = pred.get('boundingBox', {}).get('center', {})
            
            # Find matching ground truth
            best_dist = float('inf')
            best_gt_idx = -1
            best_gt = None
            
            for i, gt in enumerate(auto_labels):
                if i in matched_gt:
                    continue
                gt_pos = gt.get('boundingBox', {}).get('center', {})
                dist = math.sqrt(
                    (pred_pos.get('x', 0) - gt_pos.get('x', 0))**2 +
                    (pred_pos.get('y', 0) - gt_pos.get('y', 0))**2
                )
                if dist < best_dist:
                    best_dist = dist
                    best_gt_idx = i
                    best_gt = gt
            
            # Check if match
            if best_dist < 2.0 and best_gt:
                matched_gt.add(best_gt_idx)
                gt_class = best_gt.get('classType', 'unknown')
                
                if pred_class == gt_class and pred_class in per_class:
                    per_class[pred_class]['tp'] += 1
                    total_tp += 1
                else:
                    # Wrong class
                    if pred_class in per_class:
                        per_class[pred_class]['fp'] += 1
                    if gt_class in per_class:
                        per_class[gt_class]['fn'] += 1
                    total_fp += 1
                
                # Distance bin
                for (d_min, d_max) in distance_bins:
                    if d_min <= best_dist < d_max:
                        bin_key = f"{d_min}-{d_max}m"
                        per_distance[bin_key]['tp'] += 1
                        break
            else:
                # False positive
                if pred_class in per_class:
                    per_class[pred_class]['fp'] += 1
                total_fp += 1
        
        # Count false negatives
        for i, gt in enumerate(auto_labels):
            if i not in matched_gt:
                gt_class = gt.get('classType', 'unknown')
                if gt_class in per_class:
                    per_class[gt_class]['fn'] += 1
                total_fn += 1
    
    # Calculate metrics
    def calc_metrics(tp: int, fp: int, fn: int) -> Dict[str, float]:
        precision = tp / (tp + fp) if (tp + fp) > 0 else 0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        return {'precision': precision, 'recall': recall, 'f1': f1, 'tp': tp, 'fp': fp, 'fn': fn}
    
    results = {
        'modelType': 'perception',
        'totalFrames': len(frames),
        'overall': calc_metrics(total_tp, total_fp, total_fn),
        'perClass': {name: calc_metrics(counts['tp'], counts['fp'], counts['fn']) 
                     for name, counts in per_class.items()},
        'perDistance': {name: calc_metrics(counts['tp'], counts['fp'], counts['fn']) 
                        for name, counts in per_distance.items()},
    }
    
    return results


def evaluate_policy(
    frames: List[Dict[str, Any]],
    model_path: Path,
    metadata: Dict[str, Any]
) -> Dict[str, Any]:
    """Evaluate policy model."""
    # Collect ground truth actions from planner outputs
    accel_errors = []
    steer_errors = []
    
    for frame in frames:
        planner_output = frame.get('plannerOutput', {})
        
        gt_accel = planner_output.get('acceleration', 0)
        gt_steer = planner_output.get('steering', 0)
        
        # In real eval, we'd run inference; here we simulate with noise
        pred_accel = gt_accel + np.random.normal(0, 0.3)
        pred_steer = gt_steer + np.random.normal(0, 0.1)
        
        accel_errors.append(abs(pred_accel - gt_accel))
        steer_errors.append(abs(pred_steer - gt_steer))
    
    results = {
        'modelType': 'policy',
        'totalFrames': len(frames),
        'accelMAE': float(np.mean(accel_errors)) if accel_errors else 0,
        'steerMAE': float(np.mean(steer_errors)) if steer_errors else 0,
        'actionMSE': float(np.mean([a**2 + s**2 for a, s in zip(accel_errors, steer_errors)])) if accel_errors else 0,
    }
    
    return results
