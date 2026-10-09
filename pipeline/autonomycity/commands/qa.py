"""
Quality Assurance on labels.
Validates against taxonomy, checks consensus, scores vendors.
Uses hasNoise flag ONLY for scoring QA effectiveness, NOT for skipping validation.
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List, Tuple
import argparse


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
    
    if class_type not in taxonomy.get('classes', {}):
        errors.append(f"Unknown class: {class_type}")
        return False, errors
    
    class_rules = taxonomy['classes'][class_type]
    
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
    
    yaw = box.get('yaw', 0)
    if not (-math.pi - 0.01 <= yaw <= math.pi + 0.01):
        errors.append(f"Yaw {yaw:.3f} not normalized to [-π, π]")
    
    if label.get('isFalsePositive', False):
        errors.append("Marked as false positive by labeler")
    
    return len(errors) == 0, errors


def calculate_3d_iou(box1: Dict, box2: Dict) -> float:
    """Calculate 3D IoU between two boxes (simplified axis-aligned)."""
    c1 = box1.get('center', {})
    s1 = box1.get('size', {})
    c2 = box2.get('center', {})
    s2 = box2.get('size', {})
    
    def overlap_1d(c1, s1, c2, s2):
        min1, max1 = c1 - s1/2, c1 + s1/2
        min2, max2 = c2 - s2/2, c2 + s2/2
        overlap = max(0, min(max1, max2) - max(min1, min2))
        return overlap
    
    ox = overlap_1d(c1.get('x', 0), s1.get('x', 1), c2.get('x', 0), s2.get('x', 1))
    oy = overlap_1d(c1.get('y', 0), s1.get('y', 1), c2.get('y', 0), s2.get('y', 1))
    oz = overlap_1d(c1.get('z', 0), s1.get('z', 1), c2.get('z', 0), s2.get('z', 1))
    
    intersection = ox * oy * oz
    vol1 = s1.get('x', 1) * s1.get('y', 1) * s1.get('z', 1)
    vol2 = s2.get('x', 1) * s2.get('y', 1) * s2.get('z', 1)
    union = vol1 + vol2 - intersection
    
    return intersection / union if union > 0 else 0


def calculate_consensus(
    auto_labels: List[Dict],
    vendor_labels: List[Dict],
    center_threshold: float = 2.0,
    iou_threshold: float = 0.3
) -> Dict[str, Any]:
    """
    Calculate consensus between auto-labels and vendor labels.
    Uses center distance and IoU for matching, class agreement for validation.
    """
    if not auto_labels:
        return {
            'matchRate': 1.0 if not vendor_labels else 0,
            'classAgreement': 1.0,
            'avgIoU': 1.0 if not vendor_labels else 0,
            'disagreements': [],
            'matchedPairs': [],
        }
    
    matched = 0
    class_matches = 0
    total_iou = 0
    disagreements = []
    matched_pairs = []
    
    vendor_matched = set()
    
    for auto in auto_labels:
        auto_pos = auto.get('boundingBox', {}).get('center', {})
        auto_box = auto.get('boundingBox', {})
        best_dist = float('inf')
        best_iou = 0
        best_idx = -1
        best_vendor = None
        
        for i, vendor in enumerate(vendor_labels):
            if i in vendor_matched:
                continue
            vendor_pos = vendor.get('boundingBox', {}).get('center', {})
            vendor_box = vendor.get('boundingBox', {})
            
            dist = math.sqrt(
                (auto_pos.get('x', 0) - vendor_pos.get('x', 0))**2 +
                (auto_pos.get('y', 0) - vendor_pos.get('y', 0))**2 +
                (auto_pos.get('z', 0) - vendor_pos.get('z', 0))**2
            )
            
            iou = calculate_3d_iou(auto_box, vendor_box)
            
            if dist < center_threshold and iou > best_iou:
                best_dist = dist
                best_iou = iou
                best_idx = i
                best_vendor = vendor
        
        if best_vendor and best_iou >= iou_threshold:
            matched += 1
            vendor_matched.add(best_idx)
            total_iou += best_iou
            
            matched_pairs.append({
                'autoId': auto.get('id'),
                'vendorId': best_vendor.get('id'),
                'iou': best_iou,
                'distance': best_dist,
            })
            
            if auto.get('classType') == best_vendor.get('classType'):
                class_matches += 1
            else:
                disagreements.append({
                    'type': 'class_mismatch',
                    'autoClass': auto.get('classType'),
                    'vendorClass': best_vendor.get('classType'),
                    'autoId': auto.get('id'),
                    'vendorId': best_vendor.get('id'),
                })
        else:
            disagreements.append({
                'type': 'missing_in_vendor',
                'autoClass': auto.get('classType'),
                'autoId': auto.get('id'),
            })
    
    for i, vendor in enumerate(vendor_labels):
        if i not in vendor_matched:
            disagreements.append({
                'type': 'extra_in_vendor',
                'vendorClass': vendor.get('classType'),
                'vendorId': vendor.get('id'),
            })
    
    n_auto = len(auto_labels)
    
    return {
        'matchRate': matched / n_auto if n_auto > 0 else 1.0,
        'classAgreement': class_matches / matched if matched > 0 else 1.0,
        'avgIoU': total_iou / matched if matched > 0 else 0,
        'disagreements': disagreements,
        'matchedPairs': matched_pairs,
    }


def score_qa_effectiveness(
    frame_results: List[Dict],
    labeled_frames: List[Dict]
) -> Dict[str, Any]:
    """
    Score QA's effectiveness at catching injected errors.
    Uses the hidden hasNoise flag ONLY for evaluation, not for validation.
    
    Returns precision/recall of QA at catching errors.
    """
    tp = 0  # QA flagged, label was noisy
    fp = 0  # QA flagged, label was clean
    tn = 0  # QA passed, label was clean
    fn = 0  # QA passed, label was noisy
    
    for frame, result in zip(labeled_frames, frame_results):
        vendor_labels = frame.get('vendorLabels', [])
        qa_flagged = not result['valid']
        
        noisy_labels = sum(1 for lbl in vendor_labels if lbl.get('hasNoise', False))
        clean_labels = len(vendor_labels) - noisy_labels
        
        if qa_flagged:
            if noisy_labels > 0:
                tp += noisy_labels
                fp += clean_labels
            else:
                fp += clean_labels
        else:
            if noisy_labels > 0:
                fn += noisy_labels
                tn += clean_labels
            else:
                tn += clean_labels
    
    precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
    recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
    
    return {
        'truePositives': tp,
        'falsePositives': fp,
        'trueNegatives': tn,
        'falseNegatives': fn,
        'precision': precision,
        'recall': recall,
        'f1': f1,
    }


def run(args: argparse.Namespace) -> int:
    """Run the QA command."""
    print(f"Running QA on labels from {args.input}...")
    
    input_path = args.input
    output_path = args.output
    taxonomy = load_taxonomy(args.taxonomy)
    
    # QA thresholds (configurable)
    min_match_rate = 0.7
    min_class_agreement = 0.8
    min_iou = 0.3
    max_taxonomy_error_rate = 0.1
    
    if not input_path.exists():
        print(f"Error: Input path {input_path} does not exist")
        return 1
    
    output_path.mkdir(parents=True, exist_ok=True)
    
    label_files = list(input_path.glob('*/labels.json'))
    
    if not label_files:
        print(f"No label files found in {input_path}")
        return 1
    
    total_passed = 0
    total_failed = 0
    vendor_scores: Dict[str, Dict[str, float]] = {}
    qa_results = []
    all_frame_results = []
    all_labeled_frames = []
    
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
            taxonomy_errors = 0
            
            # Validate ALL vendor labels against taxonomy (no hasNoise bypass!)
            for label in vendor_labels:
                valid, errors = validate_label(label, taxonomy)
                if not valid:
                    taxonomy_errors += 1
                    frame_errors.extend(errors[:2])
            
            # Calculate consensus between auto-labels and vendor labels
            consensus = calculate_consensus(
                auto_labels, vendor_labels,
                center_threshold=2.0, iou_threshold=min_iou
            )
            
            # Fail frame if taxonomy error rate is too high
            if len(vendor_labels) > 0:
                taxonomy_error_rate = taxonomy_errors / len(vendor_labels)
                if taxonomy_error_rate > max_taxonomy_error_rate:
                    frame_valid = False
                    frame_errors.insert(0, f"Taxonomy error rate {taxonomy_error_rate:.1%} > {max_taxonomy_error_rate:.1%}")
            
            # Fail frame if match rate is too low
            if consensus['matchRate'] < min_match_rate:
                frame_valid = False
                frame_errors.append(f"Match rate {consensus['matchRate']:.2f} < {min_match_rate}")
            
            # Fail frame if class agreement is too low (among matched pairs)
            if consensus['classAgreement'] < min_class_agreement:
                frame_valid = False
                frame_errors.append(f"Class agreement {consensus['classAgreement']:.2f} < {min_class_agreement}")
            
            if frame_valid:
                recording_passed += 1
            else:
                recording_failed += 1
                recording_errors.extend(frame_errors[:3])
            
            frame_results.append({
                'frameNumber': frame.get('frameNumber'),
                'valid': frame_valid,
                'errors': frame_errors,
                'consensus': consensus,
            })
        
        all_frame_results.extend(frame_results)
        all_labeled_frames.extend(labeled_frames)
        
        total_passed += recording_passed
        total_failed += recording_failed
        
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
        
        # Save passed labels
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
                }, f, indent=2)
        
        print(f"  {recording_name}: {recording_passed}/{recording_passed + recording_failed} passed")
    
    # Score QA effectiveness using hidden hasNoise flag
    qa_effectiveness = score_qa_effectiveness(all_frame_results, all_labeled_frames)
    
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
        'qaEffectiveness': qa_effectiveness,
        'vendorQuality': vendor_quality,
        'results': qa_results,
        'thresholds': {
            'minMatchRate': min_match_rate,
            'minClassAgreement': min_class_agreement,
            'minIoU': min_iou,
            'maxTaxonomyErrorRate': max_taxonomy_error_rate,
        }
    }
    
    with open(output_path / 'qa_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    print(f"\nQA complete!")
    print(f"  Passed: {total_passed}")
    print(f"  Failed: {total_failed}")
    print(f"  Pass rate: {summary['overallPassRate']:.1%}")
    print(f"\nQA Effectiveness (at catching injected errors):")
    print(f"  Precision: {qa_effectiveness['precision']:.1%} (of flagged frames, how many had errors)")
    print(f"  Recall: {qa_effectiveness['recall']:.1%} (of error frames, how many were caught)")
    print(f"  F1: {qa_effectiveness['f1']:.3f}")
    print(f"\nVendor quality scores:")
    for vendor_id, quality in vendor_quality.items():
        print(f"  {vendor_id}: {quality['passRate']:.1%} ({quality['passed']}/{quality['totalLabeled']})")
    print(f"\nOutput: {output_path}")
    print(f"Rework queue: {output_path / 'rework_queue'}")
    
    return 0
