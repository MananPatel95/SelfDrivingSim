"""Tests for the mine command."""

import pytest
from autonomycity.commands.mine import (
    calculate_distance, match_detections_to_gt, calculate_ttc, mine_frame
)


def test_calculate_distance():
    """Test distance calculation."""
    p1 = {'x': 0, 'y': 0, 'z': 0}
    p2 = {'x': 3, 'y': 4, 'z': 0}
    
    dist = calculate_distance(p1, p2)
    assert abs(dist - 5.0) < 0.001


def test_match_detections_to_gt():
    """Test detection matching."""
    detections = [
        {'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}}},
        {'boundingBox': {'center': {'x': 20, 'y': 0, 'z': 1}}},
    ]
    
    ground_truth = [
        {'boundingBox': {'center': {'x': 10.5, 'y': 0, 'z': 1}}, 'isStatic': False},
        {'boundingBox': {'center': {'x': 30, 'y': 0, 'z': 1}}, 'isStatic': False},
    ]
    
    result = match_detections_to_gt(detections, ground_truth, threshold=2.0)
    
    assert len(result['matched']) == 1
    assert len(result['false_positives']) == 1  # Detection at x=20 not matched
    assert len(result['false_negatives']) == 1  # GT at x=30 not detected


def test_calculate_ttc_approaching():
    """Test TTC calculation for approaching objects."""
    ego_state = {
        'transform': {'position': {'x': 0, 'y': 0, 'z': 0}},
        'velocity': {'x': 10, 'y': 0, 'z': 0}
    }
    
    detection = {
        'boundingBox': {'center': {'x': 50, 'y': 0, 'z': 0}},
        'velocity': {'x': 0, 'y': 0, 'z': 0}
    }
    
    ttc = calculate_ttc(ego_state, detection)
    
    assert ttc is not None
    assert ttc > 0


def test_mine_frame_disengagement():
    """Test mining detects disengagements."""
    frame = {
        'timestamp': 1000,
        'frameNumber': 10,
        'egoState': {'transform': {'position': {'x': 0, 'y': 0, 'z': 0}}},
        'groundTruth': [],
        'perceptionOutput': {'detections': []},
        'takeover': {'reason': 'perception_miss'}
    }
    
    triggers = mine_frame(frame, [], [], ['disengagement'])
    
    assert len(triggers) == 1
    assert triggers[0]['type'] == 'disengagement'


def test_mine_frame_false_negative():
    """Test mining detects false negatives."""
    frame = {
        'timestamp': 1000,
        'frameNumber': 10,
        'egoState': {'transform': {'position': {'x': 0, 'y': 0, 'z': 0}}},
        'groundTruth': [
            {
                'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}},
                'classType': 'pedestrian',
                'isStatic': False
            }
        ],
        'perceptionOutput': {'detections': []}  # No detections
    }
    
    triggers = mine_frame(frame, [], [], ['false_negative'])
    
    assert len(triggers) == 1
    assert triggers[0]['type'] == 'false_negative'
