"""Tests for the validate command."""

import json
import tempfile
from pathlib import Path
import pytest

from autonomycity.commands.validate import validate_frame, validate_recording


def test_validate_frame_valid():
    """Test validation of a valid frame."""
    frame = {
        'timestamp': 1000,
        'frameNumber': 0,
        'egoState': {
            'transform': {
                'position': {'x': 0, 'y': 0, 'z': 0},
                'rotation': 0.5
            }
        },
        'groundTruth': [
            {
                'classType': 'car',
                'boundingBox': {
                    'center': {'x': 10, 'y': 5, 'z': 1},
                    'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                    'yaw': 0.0
                }
            }
        ]
    }
    
    errors = validate_frame(frame, 0)
    assert len(errors) == 0


def test_validate_frame_invalid_class():
    """Test validation catches invalid class."""
    frame = {
        'timestamp': 1000,
        'frameNumber': 0,
        'egoState': {
            'transform': {
                'position': {'x': 0, 'y': 0, 'z': 0},
                'rotation': 0.0
            }
        },
        'groundTruth': [
            {
                'classType': 'invalid_class',
                'boundingBox': {
                    'center': {'x': 10, 'y': 5, 'z': 1},
                    'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                    'yaw': 0.0
                }
            }
        ]
    }
    
    errors = validate_frame(frame, 0)
    assert len(errors) > 0
    assert 'unknown class' in errors[0].lower()


def test_validate_frame_unnormalized_yaw():
    """Test validation catches unnormalized yaw."""
    frame = {
        'timestamp': 1000,
        'frameNumber': 0,
        'egoState': {
            'transform': {
                'position': {'x': 0, 'y': 0, 'z': 0},
                'rotation': 5.0  # > pi
            }
        },
        'groundTruth': []
    }
    
    errors = validate_frame(frame, 0)
    assert len(errors) > 0
    assert 'rotation' in errors[0].lower()


def test_validate_frame_negative_size():
    """Test validation catches negative box size."""
    frame = {
        'timestamp': 1000,
        'frameNumber': 0,
        'egoState': {
            'transform': {
                'position': {'x': 0, 'y': 0, 'z': 0},
                'rotation': 0.0
            }
        },
        'groundTruth': [
            {
                'classType': 'car',
                'boundingBox': {
                    'center': {'x': 10, 'y': 5, 'z': 1},
                    'size': {'x': -1, 'y': 1.8, 'z': 1.5},
                    'yaw': 0.0
                }
            }
        ]
    }
    
    errors = validate_frame(frame, 0)
    assert len(errors) > 0
    assert 'size' in errors[0].lower()


def test_validate_recording():
    """Test validation of a complete recording."""
    with tempfile.TemporaryDirectory() as tmpdir:
        recording_path = Path(tmpdir)
        
        manifest = {
            'version': '1.0.0',
            'profile': 'baseline_lidar',
            'scenarioSeed': 42,
            'frameCount': 2,
        }
        
        frames = [
            {
                'timestamp': 0,
                'frameNumber': 0,
                'egoState': {'transform': {'position': {'x': 0, 'y': 0, 'z': 0}, 'rotation': 0}},
                'groundTruth': []
            },
            {
                'timestamp': 100,
                'frameNumber': 1,
                'egoState': {'transform': {'position': {'x': 1, 'y': 0, 'z': 0}, 'rotation': 0}},
                'groundTruth': []
            }
        ]
        
        with open(recording_path / 'manifest.json', 'w') as f:
            json.dump(manifest, f)
        
        with open(recording_path / 'frames.json', 'w') as f:
            json.dump(frames, f)
        
        result = validate_recording(recording_path)
        
        assert result['valid'] == True
        assert result['stats']['frameCount'] == 2
