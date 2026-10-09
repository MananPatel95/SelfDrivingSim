"""
Label generation with simulated vendor noise.
Auto-labels from ground truth + configurable noise injection.
"""

import json
import random
import math
from pathlib import Path
from typing import Dict, Any, List, Optional
import argparse


def inject_vendor_noise(
    labels: List[Dict[str, Any]],
    noise_rate: float,
    vendor_id: str,
    seed: int = 42
) -> List[Dict[str, Any]]:
    """
    Inject realistic labeling errors:
    - Box jitter
    - Wrong class
    - Missed objects
    - ID swaps
    """
    random.seed(seed)
    noisy_labels = []
    
    for label in labels:
        # Chance to miss the object entirely
        if random.random() < noise_rate * 0.3:
            continue  # Missed object
        
        noisy_label = label.copy()
        noisy_label['vendorId'] = vendor_id
        noisy_label['isAutoLabel'] = False
        
        # Box jitter
        label_has_noise = False
        
        if random.random() < noise_rate:
            label_has_noise = True
            box = noisy_label.get('boundingBox', {})
            center = box.get('center', {})
            size = box.get('size', {})
            
            # Add position noise (up to 0.3m)
            center['x'] = center.get('x', 0) + random.gauss(0, 0.15)
            center['y'] = center.get('y', 0) + random.gauss(0, 0.15)
            center['z'] = center.get('z', 0) + random.gauss(0, 0.1)
            
            # Add size noise (up to 10%)
            size['x'] = size.get('x', 1) * (1 + random.gauss(0, 0.05))
            size['y'] = size.get('y', 1) * (1 + random.gauss(0, 0.05))
            size['z'] = size.get('z', 1) * (1 + random.gauss(0, 0.05))
            
            # Add yaw noise (up to 5 degrees)
            box['yaw'] = box.get('yaw', 0) + random.gauss(0, 0.05)
            
            noisy_label['boundingBox'] = box
        
        # Wrong class (misclassification)
        if random.random() < noise_rate * 0.2:
            label_has_noise = True
            class_confusions = {
                'car': ['truck', 'bus'],
                'truck': ['car', 'bus'],
                'pedestrian': ['cyclist'],
                'cyclist': ['pedestrian', 'bicycle'],
                'bicycle': ['motorcycle', 'cyclist'],
            }
            current_class = noisy_label.get('classType', 'car')
            if current_class in class_confusions:
                noisy_label['classType'] = random.choice(class_confusions[current_class])
        
        # Mark if this label has noise (for QA calibration)
        noisy_label['hasNoise'] = label_has_noise
        noisy_labels.append(noisy_label)
    
    # Chance to add false positive (phantom object)
    if random.random() < noise_rate * 0.1:
        phantom = {
            'id': random.randint(10000, 99999),
            'classType': random.choice(['car', 'pedestrian', 'bicycle']),
            'boundingBox': {
                'center': {
                    'x': random.uniform(-50, 50),
                    'y': random.uniform(-50, 50),
                    'z': random.uniform(0.5, 2),
                },
                'size': {
                    'x': random.uniform(1, 5),
                    'y': random.uniform(1, 3),
                    'z': random.uniform(1, 2),
                },
                'yaw': random.uniform(-math.pi, math.pi),
            },
            'vendorId': vendor_id,
            'isAutoLabel': False,
            'isFalsePositive': True,  # Mark for QA
        }
        noisy_labels.append(phantom)
    
    return noisy_labels


def generate_labels_for_frame(
    frame: Dict[str, Any],
    vendor_noise: float,
    vendor_id: str,
    frame_seed: int
) -> Dict[str, Any]:
    """Generate labels for a single frame."""
    ground_truth = frame.get('groundTruth', [])
    
    # Auto-labels from ground truth (perfect labels)
    auto_labels = []
    for gt in ground_truth:
        if gt.get('isStatic', False):
            continue  # Skip static objects for dynamic labeling
        
        auto_labels.append({
            'id': gt.get('id'),
            'classType': gt.get('classType'),
            'boundingBox': gt.get('boundingBox'),
            'velocity': gt.get('velocity'),
            'occlusionLevel': gt.get('occlusionLevel', 0),
            'isAutoLabel': True,
            'vendorId': 'auto',
        })
    
    # If vendor noise is enabled, create noisy version
    if vendor_noise > 0 and vendor_id != 'auto':
        vendor_labels = inject_vendor_noise(auto_labels, vendor_noise, vendor_id, frame_seed)
    else:
        vendor_labels = auto_labels
    
    return {
        'timestamp': frame.get('timestamp'),
        'frameNumber': frame.get('frameNumber'),
        'autoLabels': auto_labels,
        'vendorLabels': vendor_labels,
        'labelCount': len(vendor_labels),
        'autoLabelCount': len(auto_labels),
    }


def run(args: argparse.Namespace) -> int:
    """Run the label command."""
    print(f"Generating labels from {args.input}...")
    
    input_path = args.input
    output_path = args.output
    vendor_noise = args.vendor_noise
    vendor_id = args.vendor_id
    
    if not input_path.exists():
        print(f"Error: Input path {input_path} does not exist")
        return 1
    
    # Load mined triggers
    triggers_file = input_path / 'mined_triggers.json'
    if not triggers_file.exists():
        print(f"Error: No mined_triggers.json found in {input_path}")
        return 1
    
    with open(triggers_file) as f:
        mined_data = json.load(f)
    
    output_path.mkdir(parents=True, exist_ok=True)
    
    total_labels = 0
    total_frames = 0
    labeled_recordings = []
    
    # Process each recording
    for recording_info in mined_data.get('recordings', []):
        recording_path = Path(recording_info['path'])
        frames_path = recording_path / 'frames.json'
        
        if not frames_path.exists():
            continue
        
        with open(frames_path) as f:
            frames = json.load(f)
        
        # Get frame numbers that were mined
        mined_frame_numbers = set()
        for trigger in recording_info.get('triggers', []):
            fn = trigger.get('frameNumber')
            if fn is not None:
                # Include window around trigger
                for offset in range(-30, 31):  # ±3 seconds
                    mined_frame_numbers.add(fn + offset)
        
        # Generate labels for mined frames
        labeled_frames = []
        for i, frame in enumerate(frames):
            frame_num = frame.get('frameNumber', i)
            if frame_num in mined_frame_numbers or len(mined_frame_numbers) == 0:
                labeled = generate_labels_for_frame(
                    frame, vendor_noise, vendor_id, 
                    frame_seed=hash(str(recording_path) + str(frame_num))
                )
                labeled_frames.append(labeled)
                total_labels += labeled['labelCount']
        
        if labeled_frames:
            # Save labeled frames
            recording_name = recording_path.name
            output_recording = output_path / recording_name
            output_recording.mkdir(parents=True, exist_ok=True)
            
            with open(output_recording / 'labels.json', 'w') as f:
                json.dump({
                    'recordingPath': str(recording_path),
                    'vendorId': vendor_id,
                    'vendorNoise': vendor_noise,
                    'labeledFrames': labeled_frames,
                }, f, indent=2)
            
            total_frames += len(labeled_frames)
            labeled_recordings.append({
                'recordingPath': str(recording_path),
                'outputPath': str(output_recording),
                'frameCount': len(labeled_frames),
                'labelCount': sum(f['labelCount'] for f in labeled_frames),
            })
            
            print(f"  {recording_name}: {len(labeled_frames)} frames, {sum(f['labelCount'] for f in labeled_frames)} labels")
    
    # Save summary
    summary = {
        'vendorId': vendor_id,
        'vendorNoise': vendor_noise,
        'totalFrames': total_frames,
        'totalLabels': total_labels,
        'recordings': labeled_recordings,
    }
    
    with open(output_path / 'label_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nLabeling complete!")
    print(f"  Total frames: {total_frames}")
    print(f"  Total labels: {total_labels}")
    print(f"  Vendor: {vendor_id} (noise={vendor_noise})")
    print(f"  Output: {output_path}")
    
    return 0
