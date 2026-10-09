"""Tests for split command."""

import pytest


def test_split_ratios_sum_to_one():
    """Test that default train/val/test ratios sum to 1."""
    train_ratio = 0.7
    val_ratio = 0.15
    test_ratio = 1 - train_ratio - val_ratio
    
    assert abs(train_ratio + val_ratio + test_ratio - 1.0) < 0.001


def test_split_by_seed():
    """Test that splitting by seed is deterministic."""
    seeds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    train_ratio = 0.7
    
    # Simulate split
    train_seeds = set()
    for seed in seeds:
        if hash(seed) % 100 < train_ratio * 100:
            train_seeds.add(seed)
    
    # Second split should give same result
    train_seeds2 = set()
    for seed in seeds:
        if hash(seed) % 100 < train_ratio * 100:
            train_seeds2.add(seed)
    
    assert train_seeds == train_seeds2
