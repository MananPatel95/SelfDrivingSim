"""
Mine interesting frames from recordings.
Triggers: disengagements, perception errors, low confidence, near-misses, rare scenarios.
"""

import json
import math
from pathlib import Path
from typing import List, Dict, Any, Optional
import argparse


def calculate_distance(p1: Dict[str, float], p2: Dict[str, float]) -> float:
    """Calculate Euclidean distance between two points."""
    dx = p1.get('x', 0) - p2.get('x', 0)
    dy = p1.get('y', 0) - p2.get('y', 0)
    dz = p1.get('z', 0) - p2.get('z', 0)
    return math.sqrt(dx*dx + dy*dy + dz*dz)


def match_detections_to_gt(
    detections: List[Dict], 
    ground_truth: List[Dict],
    threshold: float = 2.0
) -> Dict[str, List]:
    """
    Match detections to ground truth.
    Returns dict with 'matched', 'false_positives', 'false_negatives'.
    """
    matched = []
    false_positives = []
    false_negatives = []
    
    gt_matched = set()
    
    for det in detections:
        det_pos = det.get('boundingBox', {}).get('center', {})
        best_dist = float('inf')
        best_gt_idx = -1
        
        for i, gt in enumerate(ground_truth):
            if i in gt_matched:
                continue
            gt_pos = gt.get('boundingBox', {}).get('center', {})
            dist = calculate_distance(det_pos, gt_pos)
            if dist < best_dist:
                best_dist = dist
                best_gt_idx = i
        
        if best_dist < threshold and best_gt_idx >= 0:
            matched.append({
                'detection': det,
                'ground_truth': ground_truth[best_gt_idx],
                'distance': best_dist
            })
            gt_matched.add(best_gt_idx)
        else:
            false_positives.append(det)
    
    for i, gt in enumerate(ground_truth):
        if i not in gt_matched:
            # Skip static objects for FN analysis
            if not gt.get('isStatic', False):
                false_negatives.append(gt)
    
    return {
        'matched': matched,
        'false_positives': false_positives,
        'false_negatives': false_negatives
    }


def calculate_ttc(ego_state: Dict, detection: Dict) -> Optional[float]:
    """Calculate time-to-collision with a detection."""
    ego_pos = ego_state.get('transform', {}).get('position', {})
    ego_vel = ego_state.get('velocity', {})
    
    det_pos = detection.get('boundingBox', {}).get('center', {})
    det_vel = detection.get('velocity', {}) or {'x': 0, 'y': 0, 'z': 0}
    
    # Relative position and velocity
    rel_x = det_pos.get('x', 0) - ego_pos.get('x', 0)
    rel_y = det_pos.get('y', 0) - ego_pos.get('y', 0)
    rel_vx = det_vel.get('x', 0) - ego_vel.get('x', 0)
    rel_vy = det_vel.get('y', 0) - ego_vel.get('y', 0)
    
    # If not approaching, no collision
    rel_speed = math.sqrt(rel_vx*rel_vx + rel_vy*rel_vy)
    if rel_speed < 0.1:
        return None
    
    # Simple TTC approximation
    dist = math.sqrt(rel_x*rel_x + rel_y*rel_y)
    approaching = (rel_x * rel_vx + rel_y * rel_vy) < 0
    
    if approaching and rel_speed > 0:
        return dist / rel_speed
    
    return None


def mine_frame(
    frame: Dict[str, Any],
    prev_frames: List[Dict[str, Any]],
    next_frames: List[Dict[str, Any]],
    triggers: List[str]
) -> List[Dict[str, Any]]:
    """
    Mine a frame for interesting events.
    Returns list of mining triggers found.
    """
    mined = []
    
    ego_state = frame.get('egoState', {})
    ego_pos = ego_state.get('transform', {}).get('position', {})
    ground_truth = frame.get('groundTruth', [])
    perception_output = frame.get('perceptionOutput', {})
    detections = perception_output.get('detections', [])
    
    # Filter ground truth to dynamic objects
    dynamic_gt = [gt for gt in ground_truth if not gt.get('isStatic', False)]
    
    # Match detections to GT
    match_result = match_detections_to_gt(detections, dynamic_gt)
    
    # Trigger: Takeover/Disengagement
    if 'all' in triggers or 'disengagement' in triggers:
        if frame.get('takeover'):
            mined.append({
                'type': 'disengagement',
                'reason': frame['takeover'].get('reason', 'unknown'),
                'timestamp': frame.get('timestamp', 0),
                'frameNumber': frame.get('frameNumber', 0),
            })
    
    # Trigger: False negatives (missed detections within 20m)
    if 'all' in triggers or 'false_negative' in triggers:
        for fn in match_result['false_negatives']:
            fn_pos = fn.get('boundingBox', {}).get('center', {})
            dist = calculate_distance(ego_pos, fn_pos)
            if dist < 20:
                mined.append({
                    'type': 'false_negative',
                    'classType': fn.get('classType', 'unknown'),
                    'distance': dist,
                    'timestamp': frame.get('timestamp', 0),
                    'frameNumber': frame.get('frameNumber', 0),
                })
    
    # Trigger: False positives
    if 'all' in triggers or 'false_positive' in triggers:
        for fp in match_result['false_positives']:
            fp_pos = fp.get('boundingBox', {}).get('center', {})
            dist = calculate_distance(ego_pos, fp_pos)
            if dist < 30:
                mined.append({
                    'type': 'false_positive',
                    'classType': fp.get('classType', 'unknown'),
                    'confidence': fp.get('confidence', 0),
                    'distance': dist,
                    'timestamp': frame.get('timestamp', 0),
                    'frameNumber': frame.get('frameNumber', 0),
                })
    
    # Trigger: Low confidence detections
    if 'all' in triggers or 'low_confidence' in triggers:
        for det in detections:
            if det.get('confidence', 1.0) < 0.5:
                det_pos = det.get('boundingBox', {}).get('center', {})
                dist = calculate_distance(ego_pos, det_pos)
                if dist < 30:
                    mined.append({
                        'type': 'low_confidence',
                        'classType': det.get('classType', 'unknown'),
                        'confidence': det.get('confidence', 0),
                        'distance': dist,
                        'timestamp': frame.get('timestamp', 0),
                        'frameNumber': frame.get('frameNumber', 0),
                    })
    
    # Trigger: Near miss (TTC < 2s)
    if 'all' in triggers or 'near_miss' in triggers:
        for det in detections:
            ttc = calculate_ttc(ego_state, det)
            if ttc is not None and ttc < 2.0:
                mined.append({
                    'type': 'near_miss',
                    'ttc': ttc,
                    'classType': det.get('classType', 'unknown'),
                    'timestamp': frame.get('timestamp', 0),
                    'frameNumber': frame.get('frameNumber', 0),
                })
    
    # Trigger: Rare scenario
    if 'all' in triggers or 'rare_scenario' in triggers:
        scenario = frame.get('scenario')
        if scenario:
            mined.append({
                'type': 'rare_scenario',
                'scenario': scenario.get('type', 'unknown'),
                'timestamp': frame.get('timestamp', 0),
                'frameNumber': frame.get('frameNumber', 0),
            })
    
    return mined


def mine_recording(
    recording_path: Path,
    triggers: List[str],
    window_size: int = 30  # ±3 seconds at 10 Hz
) -> Dict[str, Any]:
    """Mine a recording for interesting frames."""
    frames_path = recording_path / 'frames.json'
    
    if not frames_path.exists():
        return {'path': str(recording_path), 'triggers': [], 'error': 'No frames.json'}
    
    with open(frames_path) as f:
        frames = json.load(f)
    
    all_triggers = []
    
    for i, frame in enumerate(frames):
        prev_frames = frames[max(0, i - window_size):i]
        next_frames = frames[i + 1:i + 1 + window_size]
        
        frame_triggers = mine_frame(frame, prev_frames, next_frames, triggers)
        for t in frame_triggers:
            t['recordingPath'] = str(recording_path)
        all_triggers.extend(frame_triggers)
    
    return {
        'path': str(recording_path),
        'triggers': all_triggers,
        'totalFrames': len(frames),
    }


def run(args: argparse.Namespace) -> int:
    """Run the mine command."""
    print(f"Mining recordings from {args.recordings_dir}...")
    
    recordings_dir = args.recordings_dir
    output_path = args.output
    triggers = args.triggers
    
    if not recordings_dir.exists():
        print(f"Error: Recordings directory {recordings_dir} does not exist")
        return 1
    
    # Find all recording directories
    recording_dirs = [d for d in recordings_dir.iterdir() if d.is_dir()]
    
    if not recording_dirs:
        print(f"No recordings found in {recordings_dir}")
        return 1
    
    print(f"Found {len(recording_dirs)} recordings")
    print(f"Triggers: {triggers}")
    
    all_results = []
    total_triggers = 0
    
    for recording_dir in recording_dirs:
        result = mine_recording(recording_dir, triggers)
        all_results.append(result)
        total_triggers += len(result.get('triggers', []))
        print(f"  {recording_dir.name}: {len(result.get('triggers', []))} triggers")
    
    # Save results
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Save all triggers
    triggers_file = output_path / 'mined_triggers.json'
    with open(triggers_file, 'w') as f:
        json.dump({
            'totalTriggers': total_triggers,
            'recordings': all_results,
            'triggerTypes': triggers,
        }, f, indent=2)
    
    # Mine shadow disagreements if present
    shadow_triggers = []
    for shadow_file in recordings_dir.glob('shadow_disagreements_*.json'):
        print(f"  Mining shadow disagreements from {shadow_file.name}")
        with open(shadow_file) as f:
            shadow_data = json.load(f)
        
        for disagreement in shadow_data.get('disagreements', []):
            shadow_triggers.append({
                'type': 'shadow_disagreement',
                'frameNumber': disagreement.get('frameNumber', 0),
                'timestamp': disagreement.get('timestamp', 0),
                'shadowModel': shadow_data.get('shadowModel', 'unknown'),
                'disagreementType': disagreement.get('disagreementType', 'unknown'),
                'magnitude': disagreement.get('magnitude', 0),
            })
        
        total_triggers += len(shadow_data.get('disagreements', []))
    
    # Mine Sim World failures if present (Waabi-style adversarial testing)
    simworld_triggers = []
    for simworld_file in recordings_dir.glob('simworld_failures_*.json'):
        print(f"  Mining Sim World failures from {simworld_file.name}")
        with open(simworld_file) as f:
            simworld_data = json.load(f)
        
        for failure in simworld_data.get('failures', []):
            simworld_triggers.append({
                'type': 'simworld_failure',
                'variantId': failure.get('variantId', 'unknown'),
                'description': failure.get('description', ''),
                'perturbationType': failure.get('perturbationType', 'unknown'),
                'actorId': failure.get('actorId', 0),
                'minTTC': failure.get('metrics', {}).get('minTTC', 0),
                'maxDecel': failure.get('metrics', {}).get('maxDecel', 0),
                'hadCollision': failure.get('metrics', {}).get('hadCollision', False),
                'timestamp': failure.get('timestamp', 0),
                'seed': failure.get('seed', 0),
            })
        
        total_triggers += len(simworld_data.get('failures', []))
    
    # Save per-type summaries
    trigger_counts: Dict[str, int] = {}
    for result in all_results:
        for trigger in result.get('triggers', []):
            t_type = trigger.get('type', 'unknown')
            trigger_counts[t_type] = trigger_counts.get(t_type, 0) + 1
    
    # Add shadow disagreements to counts
    if shadow_triggers:
        trigger_counts['shadow_disagreement'] = len(shadow_triggers)
    
    # Add Sim World failures to counts
    if simworld_triggers:
        trigger_counts['simworld_failure'] = len(simworld_triggers)
    
    summary_file = output_path / 'summary.json'
    with open(summary_file, 'w') as f:
        json.dump({
            'totalRecordings': len(all_results),
            'totalTriggers': total_triggers,
            'triggerCounts': trigger_counts,
            'shadowDisagreements': len(shadow_triggers),
            'simworldFailures': len(simworld_triggers),
        }, f, indent=2)
    
    # Save shadow triggers separately if any
    if shadow_triggers:
        shadow_triggers_file = output_path / 'shadow_triggers.json'
        with open(shadow_triggers_file, 'w') as f:
            json.dump({'triggers': shadow_triggers}, f, indent=2)
        print(f"  Shadow disagreements: {len(shadow_triggers)} triggers")
    
    # Save Sim World failures separately if any
    if simworld_triggers:
        simworld_triggers_file = output_path / 'simworld_triggers.json'
        with open(simworld_triggers_file, 'w') as f:
            json.dump({'triggers': simworld_triggers}, f, indent=2)
        print(f"  Sim World failures: {len(simworld_triggers)} triggers")
    
    print(f"\nMining complete!")
    print(f"  Total triggers: {total_triggers}")
    print(f"  By type: {trigger_counts}")
    print(f"  Output saved to: {output_path}")
    
    return 0
