"""
Quality Assurance on labels.
Validates each label individually against its matched auto-label.
Reports precision/recall per error type and per vendor.
"""

import json
import math
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional
from dataclasses import dataclass, field
from enum import Enum
import argparse


class ErrorType(str, Enum):
    JITTER = 'jitter'          # Box significantly different from auto-label
    WRONG_CLASS = 'wrong_class' # Class mismatch
    MISSED = 'missed'          # Auto-label has no vendor match
    ID_SWAP = 'id_swap'        # Label ID doesn't match source
    FALSE_POSITIVE = 'false_positive'  # Vendor label with no auto-label match
    TAXONOMY = 'taxonomy'      # Fails taxonomy constraints


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
}

# QA detection thresholds
CENTER_DISTANCE_THRESHOLD = 1.5  # meters - flag if center moves more than this
IOU_THRESHOLD = 0.5              # flag if IoU drops below this
SIZE_RATIO_THRESHOLD = 0.25     # flag if size changes by more than 25%


@dataclass
class LabelQAResult:
    """Result of QA check on a single label."""
    label_id: int
    vendor_id: str
    is_valid: bool
    detected_errors: List[ErrorType] = field(default_factory=list)
    actual_noise_type: Optional[str] = None  # From hasNoise/noiseType
    matched_auto_label_id: Optional[int] = None
    error_details: List[str] = field(default_factory=list)


def load_taxonomy(taxonomy_path: Optional[Path]) -> Dict[str, Any]:
    """Load taxonomy from file or use default."""
    if taxonomy_path and taxonomy_path.exists():
        try:
            import yaml
            with open(taxonomy_path) as f:
                return yaml.safe_load(f)
        except ImportError:
            with open(taxonomy_path) as f:
                return json.load(f)
    return DEFAULT_TAXONOMY


def calculate_3d_iou(box1: Dict, box2: Dict) -> float:
    """Calculate 3D IoU between two boxes."""
    c1 = box1.get('center', {})
    s1 = box1.get('size', {})
    c2 = box2.get('center', {})
    s2 = box2.get('size', {})
    
    def overlap_1d(c1, s1, c2, s2):
        min1, max1 = c1 - s1/2, c1 + s1/2
        min2, max2 = c2 - s2/2, c2 + s2/2
        return max(0, min(max1, max2) - max(min1, min2))
    
    ox = overlap_1d(c1.get('x', 0), s1.get('x', 1), c2.get('x', 0), s2.get('x', 1))
    oy = overlap_1d(c1.get('y', 0), s1.get('y', 1), c2.get('y', 0), s2.get('y', 1))
    oz = overlap_1d(c1.get('z', 0), s1.get('z', 1), c2.get('z', 0), s2.get('z', 1))
    
    intersection = ox * oy * oz
    vol1 = s1.get('x', 1) * s1.get('y', 1) * s1.get('z', 1)
    vol2 = s2.get('x', 1) * s2.get('y', 1) * s2.get('z', 1)
    union = vol1 + vol2 - intersection
    
    return intersection / union if union > 0 else 0


def center_distance(box1: Dict, box2: Dict) -> float:
    """Calculate distance between box centers."""
    c1 = box1.get('center', {})
    c2 = box2.get('center', {})
    return math.sqrt(
        (c1.get('x', 0) - c2.get('x', 0))**2 +
        (c1.get('y', 0) - c2.get('y', 0))**2 +
        (c1.get('z', 0) - c2.get('z', 0))**2
    )


def size_ratio(box1: Dict, box2: Dict) -> float:
    """Calculate max size ratio between boxes."""
    s1 = box1.get('size', {})
    s2 = box2.get('size', {})
    
    ratios = []
    for dim in ['x', 'y', 'z']:
        v1 = s1.get(dim, 1)
        v2 = s2.get(dim, 1)
        if v1 > 0 and v2 > 0:
            ratios.append(max(v1/v2, v2/v1))
    
    return max(ratios) if ratios else 1.0


def validate_taxonomy(label: Dict, taxonomy: Dict) -> Tuple[bool, List[str]]:
    """Validate label against taxonomy constraints."""
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
        if length < min_len * 0.7 or length > max_len * 1.3:  # Allow 30% tolerance
            errors.append(f"Length {length:.2f} out of range for {class_type}")
    
    if 'width' in class_rules:
        min_w, max_w = class_rules['width']
        if width < min_w * 0.7 or width > max_w * 1.3:
            errors.append(f"Width {width:.2f} out of range for {class_type}")
    
    if 'height' in class_rules:
        min_h, max_h = class_rules['height']
        if height < min_h * 0.7 or height > max_h * 1.3:
            errors.append(f"Height {height:.2f} out of range for {class_type}")
    
    return len(errors) == 0, errors


def qa_single_label(
    vendor_label: Dict,
    auto_labels: List[Dict],
    auto_labels_by_id: Dict[int, Dict],
    taxonomy: Dict
) -> LabelQAResult:
    """
    QA a single vendor label against auto-labels.
    First tries to match by sourceAutoLabelId, then by proximity.
    """
    vendor_id = vendor_label.get('vendorId', 'unknown')
    label_id = vendor_label.get('id', 0)
    actual_noise = vendor_label.get('noiseType', 'none')
    has_noise = vendor_label.get('hasNoise', False)
    source_id = vendor_label.get('sourceAutoLabelId')
    
    result = LabelQAResult(
        label_id=label_id,
        vendor_id=vendor_id,
        is_valid=True,
        actual_noise_type=actual_noise if has_noise else None,
    )
    
    # Check for false positive (no source auto-label)
    if source_id is None:
        result.is_valid = False
        result.detected_errors.append(ErrorType.FALSE_POSITIVE)
        result.error_details.append("No source auto-label - likely false positive")
        return result
    
    # Find matching auto-label
    matched_auto = auto_labels_by_id.get(source_id)
    
    if matched_auto is None:
        # Try proximity match
        best_dist = float('inf')
        vendor_box = vendor_label.get('boundingBox', {})
        for auto in auto_labels:
            auto_box = auto.get('boundingBox', {})
            dist = center_distance(vendor_box, auto_box)
            if dist < best_dist:
                best_dist = dist
                matched_auto = auto
        
        if matched_auto is None or best_dist > CENTER_DISTANCE_THRESHOLD * 2:
            result.is_valid = False
            result.detected_errors.append(ErrorType.FALSE_POSITIVE)
            result.error_details.append("Cannot match to any auto-label")
            return result
    
    result.matched_auto_label_id = matched_auto.get('id')
    
    # Check ID swap
    if vendor_label.get('id') != matched_auto.get('id'):
        if vendor_label.get('id') in auto_labels_by_id:
            result.detected_errors.append(ErrorType.ID_SWAP)
            result.error_details.append(f"ID {label_id} doesn't match source {source_id}")
    
    # Check class mismatch
    if vendor_label.get('classType') != matched_auto.get('classType'):
        result.detected_errors.append(ErrorType.WRONG_CLASS)
        result.error_details.append(
            f"Class {vendor_label.get('classType')} vs auto {matched_auto.get('classType')}"
        )
    
    # Check box jitter
    vendor_box = vendor_label.get('boundingBox', {})
    auto_box = matched_auto.get('boundingBox', {})
    
    dist = center_distance(vendor_box, auto_box)
    iou = calculate_3d_iou(vendor_box, auto_box)
    sr = size_ratio(vendor_box, auto_box)
    
    if dist > CENTER_DISTANCE_THRESHOLD or iou < IOU_THRESHOLD or sr > (1 + SIZE_RATIO_THRESHOLD):
        result.detected_errors.append(ErrorType.JITTER)
        result.error_details.append(
            f"Box differs: dist={dist:.2f}m, IoU={iou:.2f}, size_ratio={sr:.2f}"
        )
    
    # Check taxonomy
    tax_valid, tax_errors = validate_taxonomy(vendor_label, taxonomy)
    if not tax_valid:
        result.detected_errors.append(ErrorType.TAXONOMY)
        result.error_details.extend(tax_errors)
    
    # Mark as invalid if any errors detected
    if result.detected_errors:
        result.is_valid = False
    
    return result


def qa_frame(
    frame: Dict,
    taxonomy: Dict
) -> Tuple[List[LabelQAResult], List[Tuple[int, str]]]:
    """
    QA all labels in a frame.
    Returns (label_results, missed_objects).
    """
    auto_labels = frame.get('autoLabels', [])
    vendor_labels = frame.get('vendorLabels', [])
    
    # Build lookup by ID
    auto_labels_by_id = {l.get('id'): l for l in auto_labels}
    vendor_source_ids = {l.get('sourceAutoLabelId') for l in vendor_labels if l.get('sourceAutoLabelId')}
    
    results = []
    
    # QA each vendor label
    for vendor_label in vendor_labels:
        result = qa_single_label(vendor_label, auto_labels, auto_labels_by_id, taxonomy)
        results.append(result)
    
    # Find missed objects (auto-labels with no vendor label)
    missed = []
    for auto in auto_labels:
        auto_id = auto.get('id')
        if auto_id not in vendor_source_ids:
            missed.append((auto_id, auto.get('classType', 'unknown')))
    
    return results, missed


def calculate_effectiveness(
    all_results: List[LabelQAResult],
    all_missed: List[Tuple[int, str]],
    all_frames: List[Dict]
) -> Dict[str, Any]:
    """
    Calculate QA effectiveness at catching each error type.
    Returns precision, recall, F1 per error type and overall.
    """
    # Count by error type
    error_type_stats = {}
    for et in ErrorType:
        error_type_stats[et.value] = {
            'tp': 0,  # QA detected, was actually noisy
            'fp': 0,  # QA detected, was actually clean
            'fn': 0,  # QA missed, was actually noisy
            'tn': 0,  # QA passed, was actually clean
        }
    
    # Process detected errors
    for result in all_results:
        actual = result.actual_noise_type
        detected = result.detected_errors
        
        for et in ErrorType:
            was_this_error = (actual == et.value) if actual else False
            detected_this = et in detected
            
            if detected_this and was_this_error:
                error_type_stats[et.value]['tp'] += 1
            elif detected_this and not was_this_error:
                error_type_stats[et.value]['fp'] += 1
            elif not detected_this and was_this_error:
                error_type_stats[et.value]['fn'] += 1
            else:
                error_type_stats[et.value]['tn'] += 1
    
    # Process missed objects
    for frame in all_frames:
        auto_labels = frame.get('autoLabels', [])
        vendor_labels = frame.get('vendorLabels', [])
        vendor_source_ids = {l.get('sourceAutoLabelId') for l in vendor_labels}
        
        for auto in auto_labels:
            auto_id = auto.get('id')
            if auto_id not in vendor_source_ids:
                # This is a missed object - was it intentionally missed (noise)?
                # Check if any vendor label had this as source and was marked missed
                was_intentional_miss = False
                for vl in vendor_labels:
                    if vl.get('sourceAutoLabelId') == auto_id:
                        was_intentional_miss = vl.get('noiseType') == 'missed'
                        break
                
                # QA detected a miss (because no vendor label)
                error_type_stats['missed']['tp'] += 1
    
    # Calculate metrics per error type
    effectiveness = {}
    total_tp, total_fp, total_fn = 0, 0, 0
    
    for et_name, stats in error_type_stats.items():
        tp, fp, fn, tn = stats['tp'], stats['fp'], stats['fn'], stats['tn']
        
        precision = tp / (tp + fp) if (tp + fp) > 0 else 1.0
        recall = tp / (tp + fn) if (tp + fn) > 0 else 1.0
        f1 = 2 * precision * recall / (precision + recall) if (precision + recall) > 0 else 0
        
        effectiveness[et_name] = {
            'precision': precision,
            'recall': recall,
            'f1': f1,
            'tp': tp,
            'fp': fp,
            'fn': fn,
        }
        
        total_tp += tp
        total_fp += fp
        total_fn += fn
    
    # Overall metrics
    overall_precision = total_tp / (total_tp + total_fp) if (total_tp + total_fp) > 0 else 1.0
    overall_recall = total_tp / (total_tp + total_fn) if (total_tp + total_fn) > 0 else 1.0
    overall_f1 = 2 * overall_precision * overall_recall / (overall_precision + overall_recall) if (overall_precision + overall_recall) > 0 else 0
    
    effectiveness['overall'] = {
        'precision': overall_precision,
        'recall': overall_recall,
        'f1': overall_f1,
        'tp': total_tp,
        'fp': total_fp,
        'fn': total_fn,
    }
    
    return effectiveness


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
    
    # Find all label files (handle multi-vendor structure)
    label_files = list(input_path.glob('*/labels.json'))
    if not label_files:
        label_files = list(input_path.glob('*/*/labels.json'))
    
    if not label_files:
        print(f"No label files found in {input_path}")
        return 1
    
    all_results: List[LabelQAResult] = []
    all_missed: List[Tuple[int, str]] = []
    all_frames: List[Dict] = []
    
    vendor_stats: Dict[str, Dict] = {}
    qa_results = []
    
    for label_file in label_files:
        with open(label_file) as f:
            label_data = json.load(f)
        
        vendor_id = label_data.get('vendorId', 'unknown')
        recording_path = label_data.get('recordingPath', label_file.parent.name)
        labeled_frames = label_data.get('labeledFrames', [])
        
        if vendor_id not in vendor_stats:
            vendor_stats[vendor_id] = {
                'total_labels': 0,
                'valid_labels': 0,
                'invalid_labels': 0,
                'error_counts': {et.value: 0 for et in ErrorType},
            }
        
        recording_valid = 0
        recording_invalid = 0
        recording_errors = []
        
        for frame in labeled_frames:
            results, missed = qa_frame(frame, taxonomy)
            
            for r in results:
                all_results.append(r)
                vendor_stats[vendor_id]['total_labels'] += 1
                
                if r.is_valid:
                    vendor_stats[vendor_id]['valid_labels'] += 1
                    recording_valid += 1
                else:
                    vendor_stats[vendor_id]['invalid_labels'] += 1
                    recording_invalid += 1
                    for et in r.detected_errors:
                        vendor_stats[vendor_id]['error_counts'][et.value] += 1
                    if r.error_details:
                        recording_errors.append(r.error_details[0])
            
            all_missed.extend(missed)
            all_frames.append(frame)
        
        # Save QA'd labels
        output_recording = output_path / Path(recording_path).name
        output_recording.mkdir(parents=True, exist_ok=True)
        
        # Separate valid and invalid
        valid_frames = []
        for frame, (results, _) in zip(labeled_frames, [qa_frame(f, taxonomy) for f in labeled_frames]):
            valid_labels = [vl for vl, r in zip(frame['vendorLabels'], results) if r.is_valid]
            if valid_labels:
                valid_frame = frame.copy()
                valid_frame['vendorLabels'] = valid_labels
                valid_frames.append(valid_frame)
        
        if valid_frames:
            with open(output_recording / 'labels.json', 'w') as f:
                json.dump({
                    'recordingPath': recording_path,
                    'vendorId': vendor_id,
                    'qaStatus': 'passed',
                    'labeledFrames': valid_frames,
                }, f, indent=2)
        
        qa_results.append({
            'recording': str(recording_path),
            'vendor': vendor_id,
            'validLabels': recording_valid,
            'invalidLabels': recording_invalid,
            'sampleErrors': recording_errors[:5],
        })
        
        print(f"  {Path(recording_path).name} ({vendor_id}): {recording_valid} valid, {recording_invalid} invalid")
    
    # Calculate effectiveness
    effectiveness = calculate_effectiveness(all_results, all_missed, all_frames)
    
    # Calculate per-vendor quality
    vendor_quality = {}
    for vid, stats in vendor_stats.items():
        total = stats['total_labels']
        if total > 0:
            vendor_quality[vid] = {
                'passRate': stats['valid_labels'] / total,
                'totalLabeled': total,
                'valid': stats['valid_labels'],
                'invalid': stats['invalid_labels'],
                'errorBreakdown': stats['error_counts'],
            }
    
    # Save summary
    total_valid = sum(s['valid_labels'] for s in vendor_stats.values())
    total_invalid = sum(s['invalid_labels'] for s in vendor_stats.values())
    
    summary = {
        'totalValid': total_valid,
        'totalInvalid': total_invalid,
        'overallPassRate': total_valid / (total_valid + total_invalid) if (total_valid + total_invalid) > 0 else 0,
        'qaEffectiveness': effectiveness,
        'vendorQuality': vendor_quality,
        'results': qa_results,
    }
    
    with open(output_path / 'qa_summary.json', 'w') as f:
        json.dump(summary, f, indent=2)
    
    # Print results
    print(f"\n{'='*60}")
    print("QA RESULTS")
    print(f"{'='*60}")
    print(f"Total labels: {total_valid + total_invalid}")
    print(f"  Valid: {total_valid} ({100*total_valid/(total_valid+total_invalid):.1f}%)")
    print(f"  Invalid: {total_invalid} ({100*total_invalid/(total_valid+total_invalid):.1f}%)")
    
    print(f"\n{'='*60}")
    print("QA EFFECTIVENESS (at catching injected errors)")
    print(f"{'='*60}")
    print(f"{'Error Type':<20} {'Precision':>10} {'Recall':>10} {'F1':>10}")
    print("-" * 52)
    for et in ErrorType:
        stats = effectiveness.get(et.value, {})
        print(f"{et.value:<20} {stats.get('precision', 0)*100:>9.1f}% {stats.get('recall', 0)*100:>9.1f}% {stats.get('f1', 0):>10.3f}")
    print("-" * 52)
    overall = effectiveness.get('overall', {})
    print(f"{'OVERALL':<20} {overall.get('precision', 0)*100:>9.1f}% {overall.get('recall', 0)*100:>9.1f}% {overall.get('f1', 0):>10.3f}")
    
    print(f"\n{'='*60}")
    print("VENDOR QUALITY")
    print(f"{'='*60}")
    for vid, quality in sorted(vendor_quality.items()):
        print(f"\n{vid}:")
        print(f"  Pass rate: {quality['passRate']*100:.1f}% ({quality['valid']}/{quality['totalLabeled']})")
        print(f"  Error breakdown:")
        for et, count in quality['errorBreakdown'].items():
            if count > 0:
                print(f"    {et}: {count}")
    
    print(f"\nOutput: {output_path}")
    
    return 0
