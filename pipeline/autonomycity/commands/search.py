"""
Search for similar frames using embeddings.
"""

import json
from pathlib import Path
from typing import Dict, Any, List
import argparse

import numpy as np


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def run(args: argparse.Namespace) -> int:
    """Search for similar frames."""
    print(f"Searching for similar frames...")
    print(f"  Query: {args.query}")
    print(f"  Embeddings: {args.embeddings}")
    print(f"  Top-k: {args.top_k}")
    
    query_path = args.query
    embeddings_path = args.embeddings
    top_k = args.top_k
    
    if not query_path.exists():
        print(f"Error: Query path {query_path} does not exist")
        return 1
    
    if not embeddings_path.exists():
        print(f"Error: Embeddings path {embeddings_path} does not exist")
        return 1
    
    # Load embeddings
    embeddings = np.load(embeddings_path / 'embeddings.npy')
    
    with open(embeddings_path / 'metadata.json') as f:
        metadata = json.load(f)
    
    # Load query (could be a specific frame or embedding)
    with open(query_path) as f:
        query_data = json.load(f)
    
    # Create query embedding
    if 'embedding' in query_data:
        query_embedding = np.array(query_data['embedding'])
    else:
        # Generate embedding from frame data
        labels = query_data.get('vendorLabels', query_data.get('labels', []))
        if labels:
            label = labels[0]
            box = label.get('boundingBox', {})
            center = box.get('center', {})
            size = box.get('size', {})
            
            features = [
                center.get('x', 0) / 100,
                center.get('y', 0) / 100,
                center.get('z', 0) / 10,
                size.get('x', 0) / 10,
                size.get('y', 0) / 10,
                size.get('z', 0) / 5,
            ]
            query_embedding = np.array(features + [0] * (64 - len(features)))
        else:
            print("Error: No labels in query frame")
            return 1
    
    # Compute similarities
    similarities = []
    for i, emb in enumerate(embeddings):
        sim = cosine_similarity(query_embedding, emb)
        similarities.append((i, sim))
    
    # Sort by similarity
    similarities.sort(key=lambda x: x[1], reverse=True)
    
    # Get top-k results
    results = []
    for idx, sim in similarities[:top_k]:
        sample = metadata['samples'][idx]
        results.append({
            'index': idx,
            'similarity': sim,
            'classType': sample['classType'],
            'frameIdx': sample['frameIdx'],
            'recordingPath': sample['recordingPath'],
        })
    
    print(f"\nTop {top_k} similar frames:")
    for i, r in enumerate(results):
        print(f"  {i+1}. similarity={r['similarity']:.3f}, class={r['classType']}, frame={r['frameIdx']}")
    
    # Output results
    result_output = {
        'query': str(query_path),
        'topK': top_k,
        'results': results,
    }
    
    print(json.dumps(result_output, indent=2))
    
    return 0
