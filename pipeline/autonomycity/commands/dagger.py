"""
DAgger (Dataset Aggregation) for iterative model improvement.

Implements the DAgger algorithm:
1. Run policy in simulation with oracle supervision
2. Collect (state, oracle_action) pairs when oracle disagrees
3. Aggregate new data with existing dataset
4. Retrain model on aggregated data
"""

import json
import random
import subprocess
import sys
from pathlib import Path
from typing import Dict, Any, List
import argparse

import numpy as np


def run(args: argparse.Namespace) -> int:
    """Run DAgger iteration to produce next model version."""
    print(f"Running DAgger iteration...")
    print(f"  Current model: {args.model}")
    print(f"  Dataset: {args.dataset}")
    print(f"  Output: {args.output}")
    print(f"  Num episodes: {args.episodes}")
    print(f"  Model type: {args.model_type}")
    
    model_path = args.model
    dataset_path = args.dataset
    output_path = args.output
    
    if not model_path.exists():
        print(f"Error: Model path {model_path} does not exist")
        return 1
    
    if not dataset_path.exists():
        print(f"Error: Dataset path {dataset_path} does not exist")
        return 1
    
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Step 1: Run simulation episodes with oracle supervision to collect corrections
    print("\nStep 1: Collecting oracle corrections...")
    corrections = collect_oracle_corrections(
        model_path, 
        args.episodes, 
        args.seed
    )
    print(f"  Collected {len(corrections)} correction samples")
    
    # Step 2: Load existing dataset
    print("\nStep 2: Loading existing dataset...")
    existing_frames = load_existing_frames(dataset_path / 'train')
    print(f"  Loaded {len(existing_frames)} existing frames")
    
    # Step 3: Aggregate new corrections with existing data
    print("\nStep 3: Aggregating data...")
    aggregated_frames = aggregate_data(existing_frames, corrections, args.model_type)
    
    # Save aggregated dataset
    aggregated_dir = output_path / 'aggregated'
    aggregated_dir.mkdir(parents=True, exist_ok=True)
    
    # Copy validation data
    val_frames = load_existing_frames(dataset_path / 'val')
    
    (aggregated_dir / 'train').mkdir(exist_ok=True)
    (aggregated_dir / 'val').mkdir(exist_ok=True)
    
    with open(aggregated_dir / 'train' / 'frames.json', 'w') as f:
        json.dump(aggregated_frames, f, indent=2)
    
    with open(aggregated_dir / 'val' / 'frames.json', 'w') as f:
        json.dump(val_frames, f, indent=2)
    
    print(f"  Aggregated dataset: {len(aggregated_frames)} frames")
    
    # Step 4: Retrain model on aggregated data
    print("\nStep 4: Retraining model...")
    
    # Determine model version
    v1_version = extract_version(model_path)
    v2_version = v1_version + 1
    
    # Train new model
    new_model_path = output_path / f'{args.model_type}_v{v2_version}'
    
    if args.model_type == 'perception':
        retrain_perception(aggregated_dir, new_model_path, args)
    else:
        retrain_policy(aggregated_dir, new_model_path, args)
    
    # Save DAgger iteration metadata
    metadata = {
        'iteration': v2_version - 1,
        'previousModel': str(model_path),
        'newModel': str(new_model_path),
        'correctionsCollected': len(corrections),
        'existingFrames': len(existing_frames),
        'aggregatedFrames': len(aggregated_frames),
        'episodes': args.episodes,
        'seed': args.seed,
    }
    
    with open(output_path / 'dagger_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"\nDAgger iteration complete!")
    print(f"  New model: {new_model_path}")
    print(f"  Total samples: {len(aggregated_frames)}")
    
    return 0


def collect_oracle_corrections(model_path: Path, episodes: int, seed: int) -> List[Dict]:
    """
    Simulate running the model with oracle supervision.
    Collect (state, oracle_action) pairs where oracle corrects the model.
    """
    corrections = []
    rng = np.random.RandomState(seed)
    
    for ep in range(episodes):
        ep_seed = seed + ep
        
        # Simulate an episode (in a real impl, would run actual simulation)
        # Here we generate synthetic corrections based on expected disagreement patterns
        num_frames = rng.randint(200, 400)
        disagreement_rate = 0.05  # 5% of frames have oracle corrections
        
        for frame in range(num_frames):
            if rng.random() < disagreement_rate:
                # Generate a synthetic correction
                correction = {
                    'episode': ep,
                    'frame': frame,
                    'timestamp': frame * 100,
                    'state': {
                        'egoSpeed': float(rng.uniform(5, 15)),
                        'nearestObstDist': float(rng.uniform(5, 50)),
                        'numDetections': int(rng.randint(0, 10)),
                    },
                    'modelAction': {
                        'throttle': float(rng.uniform(0, 1)),
                        'steering': float(rng.uniform(-1, 1)),
                    },
                    'oracleAction': {
                        'throttle': float(rng.uniform(0, 1)),
                        'steering': float(rng.uniform(-1, 1)),
                    },
                    'reason': rng.choice(['perception_miss', 'too_cautious', 'safety']),
                }
                corrections.append(correction)
    
    return corrections


def load_existing_frames(path: Path) -> List[Dict]:
    """Load existing frames from dataset."""
    frames_file = path / 'frames.json'
    if not frames_file.exists():
        return []
    
    with open(frames_file) as f:
        return json.load(f)


def aggregate_data(existing_frames: List[Dict], corrections: List[Dict], model_type: str) -> List[Dict]:
    """Aggregate existing frames with new corrections."""
    aggregated = list(existing_frames)
    
    # Convert corrections to frame format
    for correction in corrections:
        if model_type == 'perception':
            # For perception, add synthetic detection labels from oracle
            frame = {
                'timestamp': correction['timestamp'],
                'frameNumber': correction['frame'],
                'vendorLabels': [
                    {
                        'classType': 'car',
                        'boundingBox': {
                            'center': {'x': correction['state']['nearestObstDist'], 'y': 0, 'z': 0.8},
                            'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                            'yaw': 0,
                        },
                        'confidence': 0.95,
                        'vendor': 'oracle',
                    }
                ],
                'source': 'dagger_correction',
            }
        else:
            # For policy, add state-action pairs
            frame = {
                'timestamp': correction['timestamp'],
                'frameNumber': correction['frame'],
                'egoState': {
                    'velocity': {'x': correction['state']['egoSpeed'], 'y': 0, 'z': 0},
                },
                'plannerOutput': correction['oracleAction'],
                'source': 'dagger_correction',
            }
        
        aggregated.append(frame)
    
    return aggregated


def extract_version(model_path: Path) -> int:
    """Extract version number from model path."""
    name = model_path.name
    if '_v' in name:
        try:
            return int(name.split('_v')[1].split('_')[0])
        except (ValueError, IndexError):
            pass
    return 1


def retrain_perception(data_dir: Path, output_path: Path, args: argparse.Namespace):
    """Retrain perception model on aggregated data."""
    from autonomycity.commands.train_perception import run as train_perception
    
    class TrainArgs:
        dataset = data_dir
        output = output_path
        epochs = getattr(args, 'epochs', 50)
        batch_size = getattr(args, 'batch_size', 32)
        lr = getattr(args, 'lr', 0.001)
    
    train_perception(TrainArgs())


def retrain_policy(data_dir: Path, output_path: Path, args: argparse.Namespace):
    """Retrain policy model on aggregated data."""
    from autonomycity.commands.train_policy import run as train_policy
    
    class TrainArgs:
        dataset = data_dir
        output = output_path
        epochs = getattr(args, 'epochs', 50)
        batch_size = getattr(args, 'batch_size', 32)
        lr = getattr(args, 'lr', 0.001)
    
    train_policy(TrainArgs())
