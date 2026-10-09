"""Tests for the QA command."""

import pytest
from autonomycity.commands.qa import validate_label, calculate_consensus


def test_validate_label_valid():
    """Test validation of a valid label."""
    taxonomy = {
        'classes': {
            'car': {'length': [3.5, 5.5], 'width': [1.5, 2.2], 'height': [1.2, 2.0]}
        }
    }
    
    label = {
        'classType': 'car',
        'boundingBox': {
            'center': {'x': 10, 'y': 5, 'z': 1},
            'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
            'yaw': 0.5
        }
    }
    
    valid, errors = validate_label(label, taxonomy)
    assert valid == True
    assert len(errors) == 0


def test_validate_label_size_violation():
    """Test validation catches size violations."""
    taxonomy = {
        'classes': {
            'car': {'length': [3.5, 5.5], 'width': [1.5, 2.2], 'height': [1.2, 2.0]}
        }
    }
    
    label = {
        'classType': 'car',
        'boundingBox': {
            'center': {'x': 10, 'y': 5, 'z': 1},
            'size': {'x': 10.0, 'y': 1.8, 'z': 1.5},  # Too long for a car
            'yaw': 0.0
        }
    }
    
    valid, errors = validate_label(label, taxonomy)
    assert valid == False
    assert len(errors) > 0


def test_calculate_consensus_perfect():
    """Test consensus with perfect match."""
    auto_labels = [
        {'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}}, 'classType': 'car'}
    ]
    vendor_labels = [
        {'boundingBox': {'center': {'x': 10.1, 'y': 0, 'z': 1}}, 'classType': 'car'}
    ]
    
    result = calculate_consensus(auto_labels, vendor_labels)
    
    assert result['matchRate'] == 1.0
    assert result['classAgreement'] == 1.0


def test_calculate_consensus_class_mismatch():
    """Test consensus detects class mismatch."""
    auto_labels = [
        {'boundingBox': {'center': {'x': 10, 'y': 0, 'z': 1}}, 'classType': 'car'}
    ]
    vendor_labels = [
        {'boundingBox': {'center': {'x': 10.1, 'y': 0, 'z': 1}}, 'classType': 'truck'}
    ]
    
    result = calculate_consensus(auto_labels, vendor_labels)
    
    assert result['matchRate'] == 1.0
    assert result['classAgreement'] == 0.0
    assert len(result['disagreements']) > 0
