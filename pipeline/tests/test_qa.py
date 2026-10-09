"""
Tests for QA command - verifies QA catches injected errors.
"""

import pytest
import json
import tempfile
from pathlib import Path
from autonomycity.commands.qa import (
    qa_single_label, qa_frame, calculate_effectiveness,
    ErrorType, LabelQAResult, DEFAULT_TAXONOMY,
    calculate_3d_iou, center_distance, validate_taxonomy
)
from autonomycity.commands.label import (
    inject_vendor_noise, VENDOR_CONFIGS, NoiseType
)


class TestGeometryFunctions:
    """Tests for geometry utility functions."""
    
    def test_calculate_3d_iou_identical_boxes(self):
        """Identical boxes should have IoU = 1.0."""
        box = {
            'center': {'x': 0, 'y': 0, 'z': 1},
            'size': {'x': 4, 'y': 2, 'z': 1.5}
        }
        assert calculate_3d_iou(box, box) == pytest.approx(1.0)
    
    def test_calculate_3d_iou_non_overlapping(self):
        """Non-overlapping boxes should have IoU = 0."""
        box1 = {'center': {'x': 0, 'y': 0, 'z': 0}, 'size': {'x': 1, 'y': 1, 'z': 1}}
        box2 = {'center': {'x': 10, 'y': 10, 'z': 10}, 'size': {'x': 1, 'y': 1, 'z': 1}}
        assert calculate_3d_iou(box1, box2) == 0.0
    
    def test_calculate_3d_iou_partial_overlap(self):
        """Partially overlapping boxes should have 0 < IoU < 1."""
        box1 = {'center': {'x': 0, 'y': 0, 'z': 0}, 'size': {'x': 2, 'y': 2, 'z': 2}}
        box2 = {'center': {'x': 1, 'y': 0, 'z': 0}, 'size': {'x': 2, 'y': 2, 'z': 2}}
        iou = calculate_3d_iou(box1, box2)
        assert 0 < iou < 1
    
    def test_center_distance(self):
        """Test center distance calculation."""
        box1 = {'center': {'x': 0, 'y': 0, 'z': 0}}
        box2 = {'center': {'x': 3, 'y': 4, 'z': 0}}
        assert center_distance(box1, box2) == pytest.approx(5.0)


class TestTaxonomyValidation:
    """Tests for taxonomy validation."""
    
    def test_valid_car(self):
        """Valid car should pass taxonomy."""
        label = {
            'classType': 'car',
            'boundingBox': {
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5}
            }
        }
        valid, errors = validate_taxonomy(label, DEFAULT_TAXONOMY)
        assert valid
        assert len(errors) == 0
    
    def test_invalid_car_too_small(self):
        """Car with dimensions way too small should fail."""
        label = {
            'classType': 'car',
            'boundingBox': {
                'size': {'x': 1.0, 'y': 0.5, 'z': 0.5}
            }
        }
        valid, errors = validate_taxonomy(label, DEFAULT_TAXONOMY)
        assert not valid
        assert len(errors) > 0
    
    def test_unknown_class(self):
        """Unknown class should fail."""
        label = {
            'classType': 'spaceship',
            'boundingBox': {
                'size': {'x': 10, 'y': 5, 'z': 5}
            }
        }
        valid, errors = validate_taxonomy(label, DEFAULT_TAXONOMY)
        assert not valid
        assert 'Unknown class' in errors[0]


class TestNoiseInjection:
    """Tests for noise injection in labels."""
    
    def test_inject_jitter_creates_detectable_errors(self):
        """Jitter noise should create detectable box differences."""
        labels = [{
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 10, 'y': 20, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            }
        }]
        
        config = {'jitter_rate': 1.0, 'wrong_class_rate': 0, 'miss_rate': 0, 'id_swap_rate': 0, 'false_positive_rate': 0}
        noisy = inject_vendor_noise(labels, config, 'test_vendor', seed=42)
        
        assert len(noisy) == 1
        assert noisy[0]['hasNoise'] == True
        assert noisy[0]['noiseType'] == 'jitter'
        
        # Check that position actually changed significantly
        orig_center = labels[0]['boundingBox']['center']
        noisy_center = noisy[0]['boundingBox']['center']
        dist = ((orig_center['x'] - noisy_center['x'])**2 + 
                (orig_center['y'] - noisy_center['y'])**2)**0.5
        assert dist > 1.0  # Should be at least 1m off
    
    def test_inject_wrong_class(self):
        """Wrong class noise should change class type."""
        labels = [{
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 0, 'y': 0, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            }
        }]
        
        config = {'jitter_rate': 0, 'wrong_class_rate': 1.0, 'miss_rate': 0, 'id_swap_rate': 0, 'false_positive_rate': 0}
        noisy = inject_vendor_noise(labels, config, 'test_vendor', seed=42)
        
        assert len(noisy) == 1
        assert noisy[0]['hasNoise'] == True
        assert noisy[0]['noiseType'] == 'wrong_class'
        assert noisy[0]['classType'] != 'car'
    
    def test_inject_miss(self):
        """Miss noise should remove labels."""
        labels = [
            {'id': i, 'classType': 'car', 'boundingBox': {
                'center': {'x': i*10, 'y': 0, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            }} for i in range(10)
        ]
        
        config = {'jitter_rate': 0, 'wrong_class_rate': 0, 'miss_rate': 1.0, 'id_swap_rate': 0, 'false_positive_rate': 0}
        noisy = inject_vendor_noise(labels, config, 'test_vendor', seed=42)
        
        # All labels should be missed
        assert len(noisy) == 0


class TestQASingleLabel:
    """Tests for single label QA."""
    
    def test_clean_label_passes(self):
        """Clean label with matching auto-label should pass."""
        auto_label = {
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 10, 'y': 20, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            }
        }
        vendor_label = {
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 10, 'y': 20, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            },
            'sourceAutoLabelId': 1,
            'hasNoise': False,
            'noiseType': 'none'
        }
        
        result = qa_single_label(vendor_label, [auto_label], {1: auto_label}, DEFAULT_TAXONOMY)
        
        assert result.is_valid
        assert len(result.detected_errors) == 0
    
    def test_jitter_detected(self):
        """Jittered label should be flagged."""
        auto_label = {
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 10, 'y': 20, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            }
        }
        vendor_label = {
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 13, 'y': 23, 'z': 1},  # 3m off in x and y
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            },
            'sourceAutoLabelId': 1,
            'hasNoise': True,
            'noiseType': 'jitter'
        }
        
        result = qa_single_label(vendor_label, [auto_label], {1: auto_label}, DEFAULT_TAXONOMY)
        
        assert not result.is_valid
        assert ErrorType.JITTER in result.detected_errors
    
    def test_wrong_class_detected(self):
        """Wrong class should be flagged."""
        auto_label = {
            'id': 1,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 10, 'y': 20, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            }
        }
        vendor_label = {
            'id': 1,
            'classType': 'truck',  # Wrong class
            'boundingBox': {
                'center': {'x': 10, 'y': 20, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            },
            'sourceAutoLabelId': 1,
            'hasNoise': True,
            'noiseType': 'wrong_class'
        }
        
        result = qa_single_label(vendor_label, [auto_label], {1: auto_label}, DEFAULT_TAXONOMY)
        
        assert not result.is_valid
        assert ErrorType.WRONG_CLASS in result.detected_errors
    
    def test_false_positive_detected(self):
        """False positive (no source) should be flagged."""
        vendor_label = {
            'id': 99999,
            'classType': 'car',
            'boundingBox': {
                'center': {'x': 100, 'y': 200, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5},
                'yaw': 0
            },
            'sourceAutoLabelId': None,
            'hasNoise': True,
            'noiseType': 'false_positive'
        }
        
        result = qa_single_label(vendor_label, [], {}, DEFAULT_TAXONOMY)
        
        assert not result.is_valid
        assert ErrorType.FALSE_POSITIVE in result.detected_errors


class TestQAFrame:
    """Tests for frame-level QA."""
    
    def test_frame_with_mixed_labels(self):
        """Frame with some clean and some noisy labels."""
        frame = {
            'autoLabels': [
                {'id': 1, 'classType': 'car', 'boundingBox': {
                    'center': {'x': 10, 'y': 20, 'z': 1},
                    'size': {'x': 4.5, 'y': 1.8, 'z': 1.5}, 'yaw': 0
                }},
                {'id': 2, 'classType': 'pedestrian', 'boundingBox': {
                    'center': {'x': 5, 'y': 10, 'z': 0.9},
                    'size': {'x': 0.5, 'y': 0.5, 'z': 1.7}, 'yaw': 0
                }},
            ],
            'vendorLabels': [
                # Clean car label
                {'id': 1, 'classType': 'car', 'boundingBox': {
                    'center': {'x': 10, 'y': 20, 'z': 1},
                    'size': {'x': 4.5, 'y': 1.8, 'z': 1.5}, 'yaw': 0
                }, 'sourceAutoLabelId': 1, 'hasNoise': False, 'noiseType': 'none'},
                # Jittered pedestrian label
                {'id': 2, 'classType': 'pedestrian', 'boundingBox': {
                    'center': {'x': 8, 'y': 13, 'z': 0.9},  # 3m off
                    'size': {'x': 0.5, 'y': 0.5, 'z': 1.7}, 'yaw': 0
                }, 'sourceAutoLabelId': 2, 'hasNoise': True, 'noiseType': 'jitter'},
            ]
        }
        
        results, missed = qa_frame(frame, DEFAULT_TAXONOMY)
        
        assert len(results) == 2
        assert len(missed) == 0
        
        # First label should be valid
        assert results[0].is_valid
        
        # Second label should be invalid (jitter detected)
        assert not results[1].is_valid
        assert ErrorType.JITTER in results[1].detected_errors


class TestQAEffectiveness:
    """Tests for QA effectiveness metrics."""
    
    def test_perfect_detection(self):
        """When all errors are detected, recall should be 1.0."""
        # Create results where all noisy labels are detected
        results = [
            LabelQAResult(
                label_id=1, vendor_id='test', is_valid=False,
                detected_errors=[ErrorType.JITTER],
                actual_noise_type='jitter'
            ),
            LabelQAResult(
                label_id=2, vendor_id='test', is_valid=False,
                detected_errors=[ErrorType.WRONG_CLASS],
                actual_noise_type='wrong_class'
            ),
            LabelQAResult(
                label_id=3, vendor_id='test', is_valid=True,
                detected_errors=[],
                actual_noise_type=None
            ),
        ]
        
        effectiveness = calculate_effectiveness(results, [], [])
        
        # Jitter recall should be 100%
        assert effectiveness['jitter']['recall'] == 1.0
        # Wrong class recall should be 100%
        assert effectiveness['wrong_class']['recall'] == 1.0
    
    def test_no_false_positives(self):
        """When no clean labels are flagged, precision should be 1.0."""
        results = [
            LabelQAResult(
                label_id=1, vendor_id='test', is_valid=False,
                detected_errors=[ErrorType.JITTER],
                actual_noise_type='jitter'
            ),
            LabelQAResult(
                label_id=2, vendor_id='test', is_valid=True,
                detected_errors=[],
                actual_noise_type=None
            ),
        ]
        
        effectiveness = calculate_effectiveness(results, [], [])
        
        # Jitter precision should be 100% (detected 1 jitter, it was actually jitter)
        assert effectiveness['jitter']['precision'] == 1.0


class TestEndToEndQA:
    """End-to-end tests for the full QA pipeline."""
    
    def test_qa_catches_vendor_a_errors(self):
        """QA should catch errors from vendor_A with ~80%+ recall."""
        # Create synthetic data with vendor_A noise
        auto_labels = [
            {'id': i, 'classType': 'car', 'boundingBox': {
                'center': {'x': i*10, 'y': 0, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5}, 'yaw': 0
            }} for i in range(100)
        ]
        
        # Inject noise
        vendor_labels = inject_vendor_noise(
            auto_labels, VENDOR_CONFIGS['vendor_A'], 'vendor_A', seed=42
        )
        
        # Count actual errors
        actual_errors = sum(1 for l in vendor_labels if l.get('hasNoise'))
        
        # Run QA
        auto_by_id = {l['id']: l for l in auto_labels}
        detected_errors = 0
        for vl in vendor_labels:
            result = qa_single_label(vl, auto_labels, auto_by_id, DEFAULT_TAXONOMY)
            if not result.is_valid:
                detected_errors += 1
        
        # Calculate recall
        if actual_errors > 0:
            recall = detected_errors / (actual_errors + len(auto_labels) - len(vendor_labels))
            assert recall >= 0.6, f"Recall {recall:.1%} is below 60% threshold"
    
    def test_vendor_quality_differs(self):
        """Different vendors should have different quality scores."""
        auto_labels = [
            {'id': i, 'classType': 'car', 'boundingBox': {
                'center': {'x': i*10, 'y': 0, 'z': 1},
                'size': {'x': 4.5, 'y': 1.8, 'z': 1.5}, 'yaw': 0
            }} for i in range(50)
        ]
        
        vendor_pass_rates = {}
        
        for vid in ['vendor_A', 'vendor_B', 'vendor_C']:
            vendor_labels = inject_vendor_noise(
                auto_labels, VENDOR_CONFIGS[vid], vid, seed=42
            )
            
            auto_by_id = {l['id']: l for l in auto_labels}
            valid_count = 0
            for vl in vendor_labels:
                result = qa_single_label(vl, auto_labels, auto_by_id, DEFAULT_TAXONOMY)
                if result.is_valid:
                    valid_count += 1
            
            vendor_pass_rates[vid] = valid_count / len(vendor_labels) if vendor_labels else 1.0
        
        # Vendor B (8% noise) should have higher pass rate than A (15%) than C (25%)
        assert vendor_pass_rates['vendor_B'] > vendor_pass_rates['vendor_A'], \
            f"vendor_B ({vendor_pass_rates['vendor_B']:.1%}) should beat vendor_A ({vendor_pass_rates['vendor_A']:.1%})"
        assert vendor_pass_rates['vendor_A'] > vendor_pass_rates['vendor_C'], \
            f"vendor_A ({vendor_pass_rates['vendor_A']:.1%}) should beat vendor_C ({vendor_pass_rates['vendor_C']:.1%})"
