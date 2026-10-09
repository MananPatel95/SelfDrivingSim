"""
Quality Assurance on labels.
Validates against taxonomy, checks consensus, scores vendors.
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List, Tuple
import argparse


# Default taxonomy if not provided
DEFAULT_TAXONOMY = {
    'classes': {
        'car': {'length': [3.5, 5.5], 'width': [1.5, 2.2], 'height': [1.2, 2.0]},
        'truck': {'length': [5.0, 20.0], 'width': [2.0, 3.0], 'height': [2.0, 4.5]},
        'bus': {'length': [8.0, 15.0], 'width': [2.2, 3.0], 'height': [2.5, 4.0]},
        'pedestrian': {'length': [0.3, 0.8], 'width': [0.3, 0.8], 'height': [1.0, 2.0]},
        'cyclist': {'length': [1.0, 2.5], 'width': [0.4, 1.0], 'height': [1.0, 2.0]},
        'bicycle': {'length': [1.0, 2.0], 'width': [0.3, 0.7], 'height': [0.5, 1.5]},
        'motorcycle': {'length': [1.5, 3.0], 'width': [0.5, 1.2], 'height': [1.0, 1.8]},
    },
    'attributes': {
        'occlusion': [0, 1, 2],
        'truncation': [0, 1, 2],
    }
}


def load_taxonomy(taxonomy_path: Path) -> Dict[str, Any]:
    """Load taxonomy from YAML or JSON file, or use default."""
    if taxonomy_path and taxonomy_path.exists():
        try:
            import yaml
            with open(taxonomy_path) as f:
                return yaml.safe_load(f)
        except ImportError:
            with open(taxonomy_path) as f:
                return json.load(f)
    return DEFAULT_TAXONOMY


def validate_label(
    label: Dict[str, Any], 
    taxonomy: Dict[str, Any]
) -> Tuple[bool, List[str]]:
    """Validate a single label against taxonomy rules."""
    errors = []
    
    class_type = label.get('classType', 'unknown')
    box = label.get('boundingBox', {})
    size = box.get('size', {})
    
    # Check class is known
    if class_type not in taxonomy.get('classes', {}):
        errors.append(f"Unknown class: {class_type}")
        return False, errors
    
    class_rules = taxonomy['classes'][class_type]
    
    # Check box dimensions
    length = max(size.get('x', 0), size.get('y', 0))
    width = min(size.get('x', 0), size.get('y', 0))
    height = size.get('z', 0)
    
    if 'length' in class_rules:
        min_len, max_len = class_rules['length']
        if length < min_len or length > max_len:
            errors.append(f"Length {length:.2f} out of range [{min_len}, {max_len}] for {class_type}")
    
    if 'width' in class_rules:
        min_w, max_w = class_rules['width']
        if width < min_w or width > max_w:
            errors.append(f"Width {width:.2f} out of range [{min_w}, {max_w}] for {class_type}")
    
    if 'height' in class_rules:
        min_h, max_h = class_rules['height']
        if height < min_h or height > max_h:
            errors.append(f"Height {height:.2f} out of range [{min_h}, {max_h}] for {class_type}")
    
    # Check yaw is normalized
    yaw = box.get('yaw', 0)
    if not (-math.pi - 0.01 <= yaw <= math.pi + 0.01):
        errors.append(f"Yaw {yaw:.3f} not normalized to [-π, π]")
    
    # Check for explicitly marked false positives
    if label.get('isFalsePositive', False):
        errors.append("Marked as false positive by labeler")
    
    return len(errors) == 0, errors


def calculate_consensus(
    auto_labels: List[Dict],
    vendor_labels: List[Dict],
    threshold: float = 1.0
) -> Dict[str, Any]:
    """
    Calculate consensus between auto-labels and vendor labels.
    Returns agreement metrics.
    """
    if not auto_labels or not vendor_labels:
        return {
            'matchRate': 0,
            'classAgreement': 0,
            'boxIoU': 0,
            'disagreements': [],
        }
    
    matched = 0
    class_matches = 0
    total_iou = 0
    disagreements = []
    
    vendor_matched = set()
    
    for auto in auto_labels:
        auto_pos = auto.get('boundingBox', {}).get('center', {})
        best_dist = float('inf')
        best_idx = -1
        best_vendor = None
        
        for i, vendor in enumerate(vendor_labels):
            if i in vendor_matched:
                continue
            vendor_pos = vendor.get('boundingBox', {}).get('center', {})
            dist = math.sqrt(
                (auto_pos.get('x', 0) - vendor_pos.get('x', 0))**2 +
                (auto_pos.get('y', 0) - vendor_pos.get('y', 0))**2 +
                (auto_pos.get('z', 0) - vendor_pos.get('z', 0))**2
            )
            if dist < best_dist:
                best_dist = dist
                best_idx = i
                best_vendor = vendor
        
        if best_dist < threshold and best_vendor:
            matched += 1
            vendor_matched.add(best_idx)
            
            # Check class agreement
            if auto.get('classType') == best_vendor.get('classType'):
                class_matches += 1
            else:
                disagreements.append({
                    'type': 'class_mismatch',
                    'autoClass': auto.get('classType'),
                    'vendorClass': best_vendor.get('classType'),
                    'autoId': auto.get('id'),
                })
            
            # Simple IoU proxy (using distance)
            iou_proxy = max(0, 1 - best_dist / threshold)
            total_iou += iou_proxy
        else:
            disagreements.append({
                'type': 'missing_in_vendor',
                'autoClass': auto.get('classType'),
                'autoId': auto.get('id'),
            })
    
    # Check for extra vendor labels
    for i, vendor in enumerate(vendor_labels):
        if i not in vendor_matched:
            disagreements.append({
                'type': 'extra_in_vendor',
                'vendorClass': vendor.get('classType'),
                'vendorId': vendor.get('id'),
            })
    
    n_auto = len(auto_labels)
    
    return {
        'matchRate': matched / n_auto if n_auto > 0 else 0,
        'classAgreement': class_matches / matched if matched > 0 else 0,
        'boxIoU': total_iou / matched if matched > 0 else 0,
        'disagreements': disagreements,
    }


def run(args: argparse.Namespace) -> int:
    """Run the QA command."""
    print(f"Running QA on labels from {args.input}...")
    
    input_path = args.input
    output_path = args.output
    taxonomy = load_taxonomy(args.taxonomy)
    
    if not input_path.exists():
        print(f"Error: Input path {input_path} does not exist")
        return 1
    
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Find label files
    label_files = list(input_path.glob('*/labels.json'))
    
    if not label_files:
        print(f"No label files found in {input_path}")
        return 1
    
    total_passed = 0
    total_failed = 0
    total_rework = 0
    vendor_scores: Dict[str, Dict[str, float]] = {}
    qa_results = []
    
    for label_file in label_files:
        recording_name = label_file.parent.name
        
        with open(label_file) as f:
            label_data = json.load(f)
        
        vendor_id = label_data.get('vendorId', 'unknown')
        labeled_frames = label_data.get('labeledFrames', [])
        
        frame_results = []
        recording_passed = 0
        recording_failed = 0
        recording_errors = []
        
        for frame in labeled_frames:
            vendor_labels = frame.get('vendorLabels', [])
            auto_labels = frame.get('autoLabels', [])
            
            frame_valid = True
            frame_errors = []
            
            # Validate each vendor label
            for label in vendor_labels:
                valid, errors = validate_label(label, taxonomy)
                if not valid:
                    frame_valid = False
                    frame_errors.extend(errors)
            
            # Calculate consensus
            consensus = calculate_consensus(auto_labels, vendor_labels)
            
            # Flag if consensus is too low
            if consensus['matchRate'] < 0.8:
                frame_valid = False
                frame_errors.append(f"Low match rate: {consensus['matchRate']:.2f}")
            
            if consensus['classAgreement'] < 0.9:
                frame_valid = False
                frame_errors.append(f"Low class agreement: {consensus['classAgreement']:.2f}")
            
            if frame_valid:
                recording_passed += 1
            else:
                recording_failed += 1
                recording_errors.extend(frame_errors[:3])  # Keep first 3 errors
            
            frame_results.append({
                'frameNumber': frame.get('frameNumber'),
                'valid': frame_valid,
                'errors': frame_errors,
                'consensus': consensus,
            })
        
        total_passed += recording_passed
        total_failed += recording_failed
        
        # Update vendor score
        if vendor_id not in vendor_scores:
            vendor_scores[vendor_id] = {'passed': 0, 'failed': 0, 'total': 0}
        vendor_scores[vendor_id]['passed'] += recording_passed
        vendor_scores[vendor_id]['failed'] += recording_failed
        vendor_scores[vendor_id]['total'] += recording_passed + recording_failed
        
        qa_result = {
            'recordingName': recording_name,
            'vendorId': vendor_id,
            'passedFrames': recording_passed,
            'failedFrames': recording_failed,
            'passRate': recording_passed / (recording_passed + recording_failed) if (recording_passed + recording_failed) > 0 else 0,
            'sampleErrors': recording_errors[:10],
        }
        qa_results.append(qa_result)
        
        # Save passed labels to output
        if recording_passed > 0:
            passed_frames = [fr for fr, res in zip(labeled_frames, frame_results) if res['valid']]
            output_recording = output_path / recording_name
            output_recording.mkdir(parents=True, exist_ok=True)
            
            with open(output_recording / 'labels.json', 'w') as f:
                json.dump({
                    'recordingPath': label_data.get('recordingPath'),
                    'vendorId': vendor_id,
                    'qaStatus': 'passed',
                    'labeledFrames': passed_frames,
                }, f, indent=2)
        
        # Save failed labels to rework queue
        if recording_failed > 0:
            failed_frames = [
                {'frame': fr, 'errors': res['errors'], 'consensusIssues': res.get('consensus', {})}
                for fr, res in zip(labeled_frames, frame_results) if not res['valid']
            ]
            rework_dir = output_path / 'rework_queue'
            rework_recording = rework_dir / recording_name
            rework_recording.mkdir(parents=True, exist_ok=True)
            
            with open(rework_recording / 'labels_for_rework.json', 'w') as f:
                json.dump({
                    'recordingPath': label_data.get('recordingPath'),
                    'vendorId': vendor_id,
                    'qaStatus': 'failed',
                    'failedFrames': failed_frames,
                    'reasonSummary': {
                        'validationErrors': sum(1 for fr in frame_results if fr.get('errors')),
                        'consensusIssues': sum(1 for fr in frame_results if not fr.get('valid') and not fr.get('errors')),
                    }
                }, f, indent=2)
        
        print(f"  {recording_name}: {recording_passed}/{recording_passed + recording_failed} passed")
    
    # Calculate vendor quality scores
    vendor_quality = {}
    for vendor_id, scores in vendor_scores.items():
        if scores['total'] > 0:
            vendor_quality[vendor_id] = {
                'passRate': scores['passed'] / scores['total'],
                'totalLabeled': scores['total'],
                'passed': scores['passed'],
                'failed': scores['failed'],
            }
    
    # Save QA summary
    summary = {
        'totalPassed': total_passed,
        'totalFailed': total_failed,
        'overallPassRate': total_passed / (total_passed + total_failed) if (total_passed + total_failed) > 0 else 0,
        'vendorQuality': vendor_quality,
        'results': qa_results,
    }
    
    with open(output_path / 'qa_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nQA complete!")
    print(f"  Passed: {total_passed}")
    print(f"  Failed: {total_failed}")
    print(f"  Pass rate: {summary['overallPassRate']:.1%}")
    print(f"\nVendor quality scores:")
    for vendor_id, quality in vendor_quality.items():
        print(f"  {vendor_id}: {quality['passRate']:.1%} ({quality['passed']}/{quality['totalLabeled']})")
    print(f"\nOutput: {output_path}")
    
    return 0
