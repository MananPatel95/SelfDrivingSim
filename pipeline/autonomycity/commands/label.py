"""
Label generation with simulated vendor noise.
Auto-labels from ground truth + configurable noise injection.
Supports multiple vendors with different error rates.
"""

import json
import random
import math
from pathlib import Path
from typing import Dict, Any, List, Optional
from enum import Enum
import argparse


class NoiseType(str, Enum):
    NONE = 'none'
    JITTER = 'jitter'          # Box position/size noise
    WRONG_CLASS = 'wrong_class' # Misclassification
    MISSED = 'missed'          # Object not labeled
    ID_SWAP = 'id_swap'        # Wrong ID assigned
    FALSE_POSITIVE = 'false_positive'  # Phantom object


# Default vendor configurations with different error rates
VENDOR_CONFIGS = {
    'vendor_A': {
        'noise_rate': 0.15,  # 15% overall error rate
        'jitter_rate': 0.10,
        'wrong_class_rate': 0.03,
        'miss_rate': 0.05,
        'id_swap_rate': 0.02,
        'false_positive_rate': 0.01,
    },
    'vendor_B': {
        'noise_rate': 0.08,  # 8% overall error rate - better vendor
        'jitter_rate': 0.04,
        'wrong_class_rate': 0.02,
        'miss_rate': 0.02,
        'id_swap_rate': 0.01,
        'false_positive_rate': 0.005,
    },
    'vendor_C': {
        'noise_rate': 0.25,  # 25% overall error rate - worse vendor
        'jitter_rate': 0.12,
        'wrong_class_rate': 0.06,
        'miss_rate': 0.08,
        'id_swap_rate': 0.04,
        'false_positive_rate': 0.02,
    },
}


def inject_vendor_noise(
    labels: List[Dict[str, Any]],
    vendor_config: Dict[str, float],
    vendor_id: str,
    seed: int = 42
) -> List[Dict[str, Any]]:
    """
    Inject realistic labeling errors with clear types.
    Returns labels with noise_type field for QA evaluation.
    """
    random.seed(seed)
    noisy_labels = []
    available_ids = [l.get('id') for l in labels]
    
    for i, label in enumerate(labels):
        # Chance to miss the object entirely
        if random.random() < vendor_config.get('miss_rate', 0.05):
            continue  # Missed object - not added to output
        
        noisy_label = label.copy()
        noisy_label['boundingBox'] = label.get('boundingBox', {}).copy()
        if 'center' in noisy_label['boundingBox']:
            noisy_label['boundingBox']['center'] = noisy_label['boundingBox']['center'].copy()
        if 'size' in noisy_label['boundingBox']:
            noisy_label['boundingBox']['size'] = noisy_label['boundingBox']['size'].copy()
        
        noisy_label['vendorId'] = vendor_id
        noisy_label['isAutoLabel'] = False
        noisy_label['sourceAutoLabelId'] = label.get('id')  # Track original ID
        
        noise_type = NoiseType.NONE
        has_noise = False
        
        # Box jitter - make errors large enough to be detectable
        if random.random() < vendor_config.get('jitter_rate', 0.05):
            has_noise = True
            noise_type = NoiseType.JITTER
            box = noisy_label['boundingBox']
            center = box.get('center', {})
            size = box.get('size', {})
            
            # Large position noise (1-3m) - enough to fail IoU check
            jitter_magnitude = random.uniform(1.5, 3.0)
            center['x'] = center.get('x', 0) + random.choice([-1, 1]) * jitter_magnitude
            center['y'] = center.get('y', 0) + random.choice([-1, 1]) * jitter_magnitude
            center['z'] = center.get('z', 0) + random.gauss(0, 0.5)
            
            # Size noise (20-40%) - enough to fail taxonomy
            size_factor = random.uniform(0.6, 0.8) if random.random() < 0.5 else random.uniform(1.3, 1.5)
            size['x'] = size.get('x', 1) * size_factor
            size['y'] = size.get('y', 1) * size_factor
            size['z'] = size.get('z', 1) * size_factor
            
            # Large yaw noise (15-30 degrees)
            box['yaw'] = box.get('yaw', 0) + random.choice([-1, 1]) * random.uniform(0.26, 0.52)
        
        # Wrong class (misclassification)
        if not has_noise and random.random() < vendor_config.get('wrong_class_rate', 0.02):
            has_noise = True
            noise_type = NoiseType.WRONG_CLASS
            class_confusions = {
                'car': ['truck', 'bus', 'motorcycle'],
                'truck': ['car', 'bus'],
                'bus': ['truck', 'car'],
                'pedestrian': ['cyclist', 'bicycle'],
                'cyclist': ['pedestrian', 'bicycle'],
                'bicycle': ['motorcycle', 'cyclist'],
                'motorcycle': ['bicycle', 'car'],
            }
            current_class = noisy_label.get('classType', 'car')
            if current_class in class_confusions:
                noisy_label['classType'] = random.choice(class_confusions[current_class])
        
        # ID swap - assign wrong ID from another object
        if not has_noise and random.random() < vendor_config.get('id_swap_rate', 0.01):
            other_ids = [oid for oid in available_ids if oid != label.get('id')]
            if other_ids:
                has_noise = True
                noise_type = NoiseType.ID_SWAP
                noisy_label['id'] = random.choice(other_ids)
        
        noisy_label['hasNoise'] = has_noise
        noisy_label['noiseType'] = noise_type.value
        noisy_labels.append(noisy_label)
    
    # False positives (phantom objects)
    if random.random() < vendor_config.get('false_positive_rate', 0.01):
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
            'hasNoise': True,
            'noiseType': NoiseType.FALSE_POSITIVE.value,
            'sourceAutoLabelId': None,
        }
        noisy_labels.append(phantom)
    
    return noisy_labels


def generate_labels_for_frame(
    frame: Dict[str, Any],
    vendor_config: Dict[str, float],
    vendor_id: str,
    frame_seed: int
) -> Dict[str, Any]:
    """Generate labels for a single frame."""
    ground_truth = frame.get('groundTruth', [])
    
    # Auto-labels from ground truth (perfect labels)
    auto_labels = []
    for gt in ground_truth:
        if gt.get('isStatic', False):
            continue
        
        auto_labels.append({
            'id': gt.get('id'),
            'classType': gt.get('classType'),
            'boundingBox': gt.get('boundingBox'),
            'velocity': gt.get('velocity'),
            'occlusionLevel': gt.get('occlusionLevel', 0),
            'isAutoLabel': True,
            'vendorId': 'auto',
        })
    
    # Create vendor labels with noise
    if vendor_config.get('noise_rate', 0) > 0:
        vendor_labels = inject_vendor_noise(auto_labels, vendor_config, vendor_id, frame_seed)
    else:
        vendor_labels = [{**l, 'vendorId': vendor_id, 'hasNoise': False, 'noiseType': 'none'} for l in auto_labels]
    
    # Count noise types
    noise_counts = {}
    for label in vendor_labels:
        nt = label.get('noiseType', 'none')
        noise_counts[nt] = noise_counts.get(nt, 0) + 1
    
    # Count missed objects
    missed_count = len(auto_labels) - len([l for l in vendor_labels if l.get('sourceAutoLabelId')])
    if missed_count > 0:
        noise_counts['missed'] = missed_count
    
    return {
        'timestamp': frame.get('timestamp'),
        'frameNumber': frame.get('frameNumber'),
        'autoLabels': auto_labels,
        'vendorLabels': vendor_labels,
        'labelCount': len(vendor_labels),
        'autoLabelCount': len(auto_labels),
        'noiseCounts': noise_counts,
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
    
    # Determine vendors to use
    vendors_to_process = []
    if vendor_id == 'multi':
        # Use all configured vendors
        vendors_to_process = list(VENDOR_CONFIGS.keys())
    elif vendor_id in VENDOR_CONFIGS:
        vendors_to_process = [vendor_id]
    else:
        # Custom single vendor
        vendors_to_process = [vendor_id]
    
    all_labeled_recordings = []
    total_labels = 0
    total_frames = 0
    
    for vid in vendors_to_process:
        if vid in VENDOR_CONFIGS:
            config = VENDOR_CONFIGS[vid]
        else:
            config = {
                'noise_rate': vendor_noise,
                'jitter_rate': vendor_noise * 0.4,
                'wrong_class_rate': vendor_noise * 0.15,
                'miss_rate': vendor_noise * 0.25,
                'id_swap_rate': vendor_noise * 0.1,
                'false_positive_rate': vendor_noise * 0.05,
            }
        
        print(f"\nProcessing vendor: {vid} (noise_rate={config['noise_rate']:.1%})")
        
        vendor_output = output_path / vid
        vendor_output.mkdir(parents=True, exist_ok=True)
        
        vendor_total_labels = 0
        vendor_total_frames = 0
        vendor_recordings = []
        
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
                    for offset in range(-30, 31):
                        mined_frame_numbers.add(fn + offset)
            
            # Generate labels for mined frames
            labeled_frames = []
            for i, frame in enumerate(frames):
                frame_num = frame.get('frameNumber', i)
                if frame_num in mined_frame_numbers or len(mined_frame_numbers) == 0:
                    labeled = generate_labels_for_frame(
                        frame, config, vid,
                        frame_seed=hash(str(recording_path) + str(frame_num) + vid)
                    )
                    labeled_frames.append(labeled)
                    vendor_total_labels += labeled['labelCount']
            
            if labeled_frames:
                recording_name = recording_path.name
                output_recording = vendor_output / recording_name
                output_recording.mkdir(parents=True, exist_ok=True)
                
                with open(output_recording / 'labels.json', 'w') as f:
                    json.dump({
                        'recordingPath': str(recording_path),
                        'vendorId': vid,
                        'vendorConfig': config,
                        'labeledFrames': labeled_frames,
                    }, f, indent=2)
                
                vendor_total_frames += len(labeled_frames)
                vendor_recordings.append({
                    'recordingPath': str(recording_path),
                    'outputPath': str(output_recording),
                    'frameCount': len(labeled_frames),
                    'labelCount': sum(f['labelCount'] for f in labeled_frames),
                })
                
                print(f"  {recording_name}: {len(labeled_frames)} frames, {sum(f['labelCount'] for f in labeled_frames)} labels")
        
        total_labels += vendor_total_labels
        total_frames += vendor_total_frames
        all_labeled_recordings.extend(vendor_recordings)
        
        # Save vendor summary
        with open(vendor_output / 'label_summary.json', 'w') as f:
            json.dump({
                'vendorId': vid,
                'vendorConfig': config,
                'totalFrames': vendor_total_frames,
                'totalLabels': vendor_total_labels,
                'recordings': vendor_recordings,
            }, f, indent=2)
    
    # Save overall summary
    summary = {
        'vendors': vendors_to_process,
        'totalFrames': total_frames,
        'totalLabels': total_labels,
        'recordings': all_labeled_recordings,
    }
    
    with open(output_path / 'label_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nLabeling complete!")
    print(f"  Vendors: {', '.join(vendors_to_process)}")
    print(f"  Total frames: {total_frames}")
    print(f"  Total labels: {total_labels}")
    print(f"  Output: {output_path}")
    
    return 0
