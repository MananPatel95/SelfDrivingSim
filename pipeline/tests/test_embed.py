"""
Tests for embed and search commands.
"""

import json
import tempfile
from pathlib import Path

import numpy as np
import pytest

from autonomycity.commands.embed import run as run_embed
from autonomycity.commands.search import run as run_search, cosine_similarity


class MockArgs:
    """Mock argparse.Namespace for testing."""
    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


def test_cosine_similarity_identical():
    """Identical vectors have similarity 1."""
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([1.0, 2.0, 3.0])
    assert abs(cosine_similarity(a, b) - 1.0) < 1e-6


def test_cosine_similarity_orthogonal():
    """Orthogonal vectors have similarity 0."""
    a = np.array([1.0, 0.0, 0.0])
    b = np.array([0.0, 1.0, 0.0])
    assert abs(cosine_similarity(a, b)) < 1e-6


def test_cosine_similarity_opposite():
    """Opposite vectors have similarity -1."""
    a = np.array([1.0, 2.0, 3.0])
    b = np.array([-1.0, -2.0, -3.0])
    assert abs(cosine_similarity(a, b) + 1.0) < 1e-6


def test_cosine_similarity_zero_vector():
    """Zero vector returns 0 similarity."""
    a = np.array([0.0, 0.0, 0.0])
    b = np.array([1.0, 2.0, 3.0])
    assert cosine_similarity(a, b) == 0.0


def test_embed_generates_embeddings():
    """embed command generates embeddings from frames."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        
        # Create mock model directory
        model_dir = tmp / 'model'
        model_dir.mkdir()
        (model_dir / 'model.pt').write_text('mock')
        
        # Create mock data with frames
        data_dir = tmp / 'data'
        data_dir.mkdir()
        frames = [
            {
                'vendorLabels': [
                    {
                        'classType': 'car',
                        'boundingBox': {
                            'center': {'x': 10, 'y': 20, 'z': 1},
                            'size': {'x': 4, 'y': 2, 'z': 1.5}
                        }
                    }
                ]
            },
            {
                'vendorLabels': [
                    {
                        'classType': 'pedestrian',
                        'boundingBox': {
                            'center': {'x': 5, 'y': 15, 'z': 0.9},
                            'size': {'x': 0.5, 'y': 0.5, 'z': 1.7}
                        }
                    }
                ]
            }
        ]
        (data_dir / 'frames.json').write_text(json.dumps(frames))
        
        # Run embed
        output_dir = tmp / 'embeddings'
        args = MockArgs(model=model_dir, data=data_dir, output=output_dir)
        result = run_embed(args)
        
        assert result == 0
        assert (output_dir / 'embeddings.npy').exists()
        assert (output_dir / 'metadata.json').exists()
        
        # Verify embeddings
        embeddings = np.load(output_dir / 'embeddings.npy')
        assert embeddings.shape[0] == 2  # 2 labels
        assert embeddings.shape[1] == 64  # 64-dim embeddings
        
        with open(output_dir / 'metadata.json') as f:
            metadata = json.load(f)
        assert metadata['numEmbeddings'] == 2
        assert len(metadata['samples']) == 2
        assert metadata['samples'][0]['classType'] == 'car'
        assert metadata['samples'][1]['classType'] == 'pedestrian'


def test_search_finds_similar():
    """search command finds similar frames."""
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp = Path(tmpdir)
        
        # Create embeddings
        embeddings_dir = tmp / 'embeddings'
        embeddings_dir.mkdir()
        
        embeddings = np.array([
            [0.1, 0.2, 0.1] + [0] * 61,  # car-like
            [0.05, 0.15, 0.09] + [0] * 61,  # ped-like
            [0.12, 0.22, 0.11] + [0] * 61,  # another car-like
        ], dtype=np.float32)
        np.save(embeddings_dir / 'embeddings.npy', embeddings)
        
        metadata = {
            'numEmbeddings': 3,
            'embeddingDim': 64,
            'samples': [
                {'frameIdx': 0, 'labelIdx': 0, 'classType': 'car', 'recordingPath': 'rec1'},
                {'frameIdx': 1, 'labelIdx': 0, 'classType': 'pedestrian', 'recordingPath': 'rec1'},
                {'frameIdx': 2, 'labelIdx': 0, 'classType': 'car', 'recordingPath': 'rec2'},
            ]
        }
        (embeddings_dir / 'metadata.json').write_text(json.dumps(metadata))
        
        # Create query (car-like)
        query_file = tmp / 'query.json'
        query = {
            'labels': [
                {
                    'classType': 'car',
                    'boundingBox': {
                        'center': {'x': 10, 'y': 20, 'z': 1},
                        'size': {'x': 4, 'y': 2, 'z': 1.5}
                    }
                }
            ]
        }
        query_file.write_text(json.dumps(query))
        
        # Run search
        args = MockArgs(query=query_file, embeddings=embeddings_dir, top_k=2)
        result = run_search(args)
        
        assert result == 0
