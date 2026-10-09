"""
Create train/val/test splits.
Splits by scenario seed/episode, never by frame.
Maintains frozen benchmark set.
"""

import json
import random
from pathlib import Path
from typing import Dict, Any, List, Set
import argparse


def run(args: argparse.Namespace) -> int:
    """Run the split command."""
    print(f"Creating splits from {args.input}...")
    
    input_path = args.input
    output_path = args.output
    train_ratio = args.train_ratio
    val_ratio = args.val_ratio
    benchmark_seeds_path = args.benchmark_seeds
    
    if not input_path.exists():
        print(f"Error: Input path {input_path} does not exist")
        return 1
    
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Load benchmark seeds if provided
    benchmark_seeds: Set[int] = set()
    if benchmark_seeds_path and benchmark_seeds_path.exists():
        with open(benchmark_seeds_path) as f:
            benchmark_data = json.load(f)
            benchmark_seeds = set(benchmark_data.get('seeds', []))
    
    # Find all labeled recordings
    label_files = list(input_path.glob('*/labels.json'))
    
    if not label_files:
        print(f"No label files found in {input_path}")
        return 1
    
    # Group by scenario seed
    recordings_by_seed: Dict[int, List[Path]] = {}
    
    for label_file in label_files:
        with open(label_file) as f:
            label_data = json.load(f)
        
        recording_path = label_data.get('recordingPath', '')
        # Extract seed from path or manifest
        # Assuming format: profile_seedN_env_timestamp
        parts = Path(recording_path).name.split('_')
        seed = 0
        for part in parts:
            if part.startswith('seed'):
                try:
                    seed = int(part[4:])
                    break
                except ValueError:
                    pass
        
        if seed not in recordings_by_seed:
            recordings_by_seed[seed] = []
        recordings_by_seed[seed].append(label_file)
    
    # Separate benchmark seeds
    benchmark_recordings = []
    trainable_seeds = []
    
    for seed, files in recordings_by_seed.items():
        if seed in benchmark_seeds:
            benchmark_recordings.extend(files)
        else:
            trainable_seeds.append(seed)
    
    # Shuffle and split remaining seeds
    random.seed(42)
    random.shuffle(trainable_seeds)
    
    n_total = len(trainable_seeds)
    n_train = int(n_total * train_ratio)
    n_val = int(n_total * val_ratio)
    
    train_seeds = set(trainable_seeds[:n_train])
    val_seeds = set(trainable_seeds[n_train:n_train + n_val])
    test_seeds = set(trainable_seeds[n_train + n_val:])
    
    # Collect files for each split
    train_files = []
    val_files = []
    test_files = []
    
    for seed, files in recordings_by_seed.items():
        if seed in benchmark_seeds:
            continue
        if seed in train_seeds:
            train_files.extend(files)
        elif seed in val_seeds:
            val_files.extend(files)
        else:
            test_files.extend(files)
    
    # Copy files to split directories
    def copy_to_split(files: List[Path], split_name: str):
        split_dir = output_path / split_name
        split_dir.mkdir(exist_ok=True)
        
        all_frames = []
        for label_file in files:
            with open(label_file) as f:
                label_data = json.load(f)
            
            for frame in label_data.get('labeledFrames', []):
                frame['recordingPath'] = label_data.get('recordingPath', '')
                all_frames.append(frame)
        
        with open(split_dir / 'frames.json', 'w') as f:
            json.dump(all_frames, f)
        
        return len(all_frames)
    
    train_count = copy_to_split(train_files, 'train')
    val_count = copy_to_split(val_files, 'val')
    test_count = copy_to_split(test_files, 'test')
    benchmark_count = copy_to_split(benchmark_recordings, 'benchmark')
    
    # Save split metadata
    metadata = {
        'trainSeeds': list(train_seeds),
        'valSeeds': list(val_seeds),
        'testSeeds': list(test_seeds),
        'benchmarkSeeds': list(benchmark_seeds),
        'trainFrames': train_count,
        'valFrames': val_count,
        'testFrames': test_count,
        'benchmarkFrames': benchmark_count,
        'trainRatio': train_ratio,
        'valRatio': val_ratio,
    }
    
    with open(output_path / 'split_metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"\nSplit complete!")
    print(f"  Train: {train_count} frames ({len(train_seeds)} seeds)")
    print(f"  Val: {val_count} frames ({len(val_seeds)} seeds)")
    print(f"  Test: {test_count} frames ({len(test_seeds)} seeds)")
    print(f"  Benchmark: {benchmark_count} frames ({len(benchmark_seeds)} seeds)")
    print(f"\nOutput: {output_path}")
    
    return 0
