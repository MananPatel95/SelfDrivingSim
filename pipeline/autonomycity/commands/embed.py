"""
Generate embeddings for similarity search.
"""

import json
from pathlib import Path
from typing import Dict, Any, List
import argparse

import numpy as np


def run(args: argparse.Namespace) -> int:
    """Generate embeddings."""
    print(f"Generating embeddings...")
    print(f"  Model: {args.model}")
    print(f"  Data: {args.data}")
    print(f"  Output: {args.output}")
    
    model_path = args.model
    data_path = args.data
    output_path = args.output
    
    if not model_path.exists():
        print(f"Error: Model path {model_path} does not exist")
        return 1
    
    if not data_path.exists():
        print(f"Error: Data path {data_path} does not exist")
        return 1
    
    # Load data
    frames_file = data_path / 'frames.json'
    if not frames_file.exists():
        print(f"Error: No frames.json found")
        return 1
    
    with open(frames_file) as f:
        frames = json.load(f)
    
    print(f"  Processing {len(frames)} frames...")
    
    # Generate embeddings (simulated - in production would use actual model)
    embeddings = []
    metadata_list = []
    
    for i, frame in enumerate(frames):
        # Create a simple embedding based on frame content
        labels = frame.get('vendorLabels', [])
        
        for j, label in enumerate(labels):
            box = label.get('boundingBox', {})
            center = box.get('center', {})
            size = box.get('size', {})
            
            # Simple feature vector
            features = [
                center.get('x', 0) / 100,
                center.get('y', 0) / 100,
                center.get('z', 0) / 10,
                size.get('x', 0) / 10,
                size.get('y', 0) / 10,
                size.get('z', 0) / 5,
            ]
            
            # Pad to 64 dimensions
            embedding = features + [0] * (64 - len(features))
            
            embeddings.append(embedding)
            metadata_list.append({
                'frameIdx': i,
                'labelIdx': j,
                'classType': label.get('classType', 'unknown'),
                'recordingPath': frame.get('recordingPath', ''),
            })
    
    # Save embeddings
    output_path.mkdir(parents=True, exist_ok=True)
    
    embeddings_array = np.array(embeddings, dtype=np.float32)
    np.save(output_path / 'embeddings.npy', embeddings_array)
    
    with open(output_path / 'metadata.json', 'w') as f:
        json.dump({
            'numEmbeddings': len(embeddings),
            'embeddingDim': 64,
            'samples': metadata_list,
        }, f, indent=2)
    
    print(f"\nEmbedding complete!")
    print(f"  Generated {len(embeddings)} embeddings")
    print(f"  Output: {output_path}")
    
    return 0
