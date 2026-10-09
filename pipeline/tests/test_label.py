"""Tests for label command."""

import json
import pytest
from pathlib import Path
import tempfile

from autonomycity.commands.label import inject_vendor_noise, VENDOR_CONFIGS


def test_inject_vendor_noise_preserves_clean_labels():
    """Test that 0% noise preserves labels."""
    labels = [
        {'id': 1, 'classType': 'car', 'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}, 'size': {'x': 4, 'y': 2, 'z': 1.5}, 'yaw': 0}},
    ]
    config = {'jitter_rate': 0, 'wrong_class_rate': 0, 'miss_rate': 0, 'id_swap_rate': 0, 'false_positive_rate': 0}
    result = inject_vendor_noise(labels, config, vendor_id='test_vendor', seed=42)
    assert len(result) == 1
    assert result[0]['classType'] == 'car'
    assert result[0]['hasNoise'] == False


def test_inject_vendor_noise_modifies_with_high_noise():
    """Test that high noise modifies some labels."""
    labels = []
    for i in range(10):
        labels.append({'id': i, 'classType': 'car', 'boundingBox': {'center': {'x': 10+i, 'y': 0, 'z': 1}, 'size': {'x': 4, 'y': 2, 'z': 1.5}, 'yaw': 0}})
        labels.append({'id': 100+i, 'classType': 'pedestrian', 'boundingBox': {'center': {'x': 20+i, 'y': 5, 'z': 0.9}, 'size': {'x': 0.5, 'y': 0.5, 'z': 1.7}, 'yaw': 0}})
    
    config = {'jitter_rate': 0.3, 'wrong_class_rate': 0.1, 'miss_rate': 0.2, 'id_swap_rate': 0.05, 'false_positive_rate': 0.1}
    result = inject_vendor_noise(labels, config, vendor_id='test_vendor', seed=42)
    
    # With high noise, should have some modifications
    # Check that at least some were modified (box jitter, class change, or dropped)
    assert len(result) <= len(labels)  # May have dropped some
    noisy_count = sum(1 for l in result if l.get('hasNoise', False))
    assert noisy_count > 0  # Should have some noisy labels


def test_inject_vendor_noise_deterministic():
    """Test that same seed gives same results."""
    labels = [
        {'id': i, 'classType': 'car', 'boundingBox': {'center': {'x': 10+i, 'y': 0, 'z': 1}, 'size': {'x': 4, 'y': 2, 'z': 1.5}, 'yaw': 0}}
        for i in range(5)
    ]
    
    config = {'jitter_rate': 0.2, 'wrong_class_rate': 0.1, 'miss_rate': 0.1, 'id_swap_rate': 0.05, 'false_positive_rate': 0.05}
    result1 = inject_vendor_noise([l.copy() for l in labels], config, vendor_id='v1', seed=123)
    result2 = inject_vendor_noise([l.copy() for l in labels], config, vendor_id='v1', seed=123)
    
    assert len(result1) == len(result2)
    for r1, r2 in zip(result1, result2):
        assert r1.get('hasNoise') == r2.get('hasNoise')


def test_vendor_configs_have_different_rates():
    """Test that pre-configured vendors have different noise rates."""
    assert VENDOR_CONFIGS['vendor_A']['noise_rate'] != VENDOR_CONFIGS['vendor_B']['noise_rate']
    assert VENDOR_CONFIGS['vendor_B']['noise_rate'] != VENDOR_CONFIGS['vendor_C']['noise_rate']
    
    # vendor_B should be best, vendor_C worst
    assert VENDOR_CONFIGS['vendor_B']['noise_rate'] < VENDOR_CONFIGS['vendor_A']['noise_rate']
    assert VENDOR_CONFIGS['vendor_A']['noise_rate'] < VENDOR_CONFIGS['vendor_C']['noise_rate']
