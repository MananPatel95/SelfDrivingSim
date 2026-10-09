"""
Validate recordings against the schema and sanity rules.
"""

import json
import math
from pathlib import Path
from typing import List, Dict, Any
import argparse


def validate_frame(frame: Dict[str, Any], frame_idx: int) -> List[str]:
    """Validate a single frame and return list of errors."""
    errors = []
    
    # Required fields
    required = ['timestamp', 'frameNumber', 'egoState', 'groundTruth']
    for field in required:
        if field not in frame:
            errors.append(f"Frame {frame_idx}: missing required field '{field}'")
    
    # Timestamp should be positive and monotonic (checked elsewhere)
    if 'timestamp' in frame:
        if not isinstance(frame['timestamp'], (int, float)) or frame['timestamp'] < 0:
            errors.append(f"Frame {frame_idx}: invalid timestamp {frame['timestamp']}")
    
    # Validate ego state
    if 'egoState' in frame:
        ego = frame['egoState']
        if 'transform' in ego:
            pos = ego['transform'].get('position', {})
            for coord in ['x', 'y', 'z']:
                val = pos.get(coord, 0)
                if not math.isfinite(val):
                    errors.append(f"Frame {frame_idx}: ego position.{coord} is not finite: {val}")
        
        # Yaw should be normalized to [-pi, pi]
        if 'transform' in ego:
            rotation = ego['transform'].get('rotation', 0)
            if not (-math.pi - 0.01 <= rotation <= math.pi + 0.01):
                errors.append(f"Frame {frame_idx}: ego rotation {rotation} not in [-pi, pi]")
    
    # Validate ground truth boxes
    if 'groundTruth' in frame:
        for i, gt in enumerate(frame['groundTruth']):
            box = gt.get('boundingBox', {})
            size = box.get('size', {})
            
            # Check class type is known
            valid_classes = [
                'car', 'truck', 'bus', 'motorcycle', 'bicycle',
                'pedestrian', 'cyclist', 'traffic_light', 'traffic_sign',
                'pole', 'tree', 'building', 'barrier', 'cone',
                'train', 'ship', 'boat', 'buoy'
            ]
            class_type = gt.get('classType', '')
            if class_type not in valid_classes:
                errors.append(f"Frame {frame_idx}, GT {i}: unknown class '{class_type}'")
            
            # Box sizes should be positive and reasonable
            for dim in ['x', 'y', 'z']:
                val = size.get(dim, 0)
                if val <= 0:
                    errors.append(f"Frame {frame_idx}, GT {i}: box size.{dim} <= 0: {val}")
                if val > 500:  # Very large
                    errors.append(f"Frame {frame_idx}, GT {i}: box size.{dim} suspiciously large: {val}")
            
            # Yaw normalized
            yaw = box.get('yaw', 0)
            if not (-math.pi - 0.01 <= yaw <= math.pi + 0.01):
                errors.append(f"Frame {frame_idx}, GT {i}: yaw {yaw} not in [-pi, pi]")
    
    return errors


def validate_recording(recording_path: Path) -> Dict[str, Any]:
    """Validate a recording and return validation result."""
    result = {
        'path': str(recording_path),
        'valid': True,
        'errors': [],
        'warnings': [],
        'stats': {}
    }
    
    # Load manifest
    manifest_path = recording_path / 'manifest.json'
    frames_path = recording_path / 'frames.json'
    
    if not manifest_path.exists():
        result['valid'] = False
        result['errors'].append(f"Missing manifest.json in {recording_path}")
        return result
    
    if not frames_path.exists():
        result['valid'] = False
        result['errors'].append(f"Missing frames.json in {recording_path}")
        return result
    
    try:
        with open(manifest_path) as f:
            manifest = json.load(f)
        with open(frames_path) as f:
            frames = json.load(f)
    except json.JSONDecodeError as e:
        result['valid'] = False
        result['errors'].append(f"JSON parse error: {e}")
        return result
    
    # Validate manifest
    required_manifest = ['version', 'profile', 'scenarioSeed', 'frameCount']
    for field in required_manifest:
        if field not in manifest:
            result['errors'].append(f"Manifest missing field: {field}")
            result['valid'] = False
    
    # Check frame count matches
    if len(frames) != manifest.get('frameCount', 0):
        result['warnings'].append(
            f"Frame count mismatch: manifest says {manifest.get('frameCount')}, "
            f"actual {len(frames)}"
        )
    
    # Validate each frame
    prev_timestamp = -1
    for i, frame in enumerate(frames):
        frame_errors = validate_frame(frame, i)
        result['errors'].extend(frame_errors)
        
        # Check monotonic timestamps
        ts = frame.get('timestamp', 0)
        if ts <= prev_timestamp:
            result['errors'].append(
                f"Frame {i}: non-monotonic timestamp {ts} <= {prev_timestamp}"
            )
        prev_timestamp = ts
    
    if result['errors']:
        result['valid'] = False
    
    # Collect stats
    result['stats'] = {
        'frameCount': len(frames),
        'profile': manifest.get('profile', 'unknown'),
        'scenarioSeed': manifest.get('scenarioSeed', 0),
        'duration': manifest.get('metadata', {}).get('duration', 0),
    }
    
    return result


def run(args: argparse.Namespace) -> int:
    """Run the validate command."""
    print("Validating recordings...")
    
    all_valid = True
    results = []
    
    for recording_path in args.recordings:
        if recording_path.is_dir():
            result = validate_recording(recording_path)
        else:
            # Could be a zip or direct frames.json
            result = {
                'path': str(recording_path),
                'valid': False,
                'errors': ['Expected a directory containing manifest.json and frames.json'],
                'warnings': [],
                'stats': {}
            }
        
        results.append(result)
        
        status = "✓ VALID" if result['valid'] else "✗ INVALID"
        print(f"  {recording_path.name}: {status}")
        
        if result['errors']:
            for err in result['errors'][:5]:  # Show first 5 errors
                print(f"    ERROR: {err}")
            if len(result['errors']) > 5:
                print(f"    ... and {len(result['errors']) - 5} more errors")
        
        if result['warnings']:
            for warn in result['warnings'][:3]:
                print(f"    WARN: {warn}")
        
        if not result['valid']:
            all_valid = False
    
    print(f"\nValidated {len(results)} recordings")
    valid_count = sum(1 for r in results if r['valid'])
    print(f"  Valid: {valid_count}/{len(results)}")
    
    return 0 if all_valid else 1
