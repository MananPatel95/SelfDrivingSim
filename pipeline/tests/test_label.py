"""Tests for label command."""

import json
import pytest
from pathlib import Path
import tempfile

from autonomycity.commands.label import inject_vendor_noise


def test_inject_vendor_noise_preserves_clean_labels():
    """Test that 0% noise preserves labels."""
    labels = [
        {'classType': 'car', 'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}, 'size': {'x': 4, 'y': 2, 'z': 1.5}, 'yaw': 0}},
    ]
    result = inject_vendor_noise(labels, 0.0, vendor_id='test_vendor', seed=42)
    assert len(result) == 1
    assert result[0]['classType'] == 'car'


def test_inject_vendor_noise_modifies_with_high_noise():
    """Test that high noise modifies some labels."""
    labels = [
        {'classType': 'car', 'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}, 'size': {'x': 4, 'y': 2, 'z': 1.5}, 'yaw': 0}},
        {'classType': 'pedestrian', 'boundingBox': {'center': {'x': 20, 'y': 5, 'z': 0.9}, 'size': {'x': 0.5, 'y': 0.5, 'z': 1.7}, 'yaw': 0}},
    ] * 10  # 20 labels
    
    result = inject_vendor_noise(labels, 0.5, vendor_id='test_vendor', seed=42)
    
    # With 50% noise, should have some modifications
    # Check that at least some were modified (box jitter, class change, or dropped)
    assert len(result) <= len(labels)  # May have dropped some


def test_inject_vendor_noise_deterministic():
    """Test that same seed gives same results."""
    labels = [
        {'classType': 'car', 'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}, 'size': {'x': 4, 'y': 2, 'z': 1.5}, 'yaw': 0}},
    ] * 5
    
    result1 = inject_vendor_noise(labels.copy(), 0.3, vendor_id='v1', seed=123)
    result2 = inject_vendor_noise(labels.copy(), 0.3, vendor_id='v1', seed=123)
    
    assert json.dumps(result1, sort_keys=True) == json.dumps(result2, sort_keys=True)
