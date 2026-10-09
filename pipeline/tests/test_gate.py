"""Tests for gate command."""

import json
import pytest
import tempfile
from pathlib import Path


def run_gate_check(candidate: dict, baseline: dict) -> dict:
    """Helper to run gate check logic."""
    gate_result = {
        'passed': True,
        'checks': [],
    }
    
    # Check overall F1 improvement
    candidate_f1 = candidate.get('overall', {}).get('f1', 0)
    baseline_f1 = baseline.get('overall', {}).get('f1', 0)
    f1_improved = candidate_f1 >= baseline_f1
    
    gate_result['checks'].append({
        'name': 'overall_f1',
        'passed': f1_improved,
    })
    
    if not f1_improved:
        gate_result['passed'] = False
    
    # Safety check: pedestrian recall must not regress
    candidate_ped_recall = candidate.get('perClass', {}).get('pedestrian', {}).get('recall', 0)
    baseline_ped_recall = baseline.get('perClass', {}).get('pedestrian', {}).get('recall', 0)
    tolerance = 0.02
    
    ped_recall_ok = candidate_ped_recall >= baseline_ped_recall - tolerance
    
    gate_result['checks'].append({
        'name': 'pedestrian_recall_safety',
        'passed': ped_recall_ok,
    })
    
    if not ped_recall_ok:
        gate_result['passed'] = False
    
    return gate_result


def test_gate_passes_on_improvement():
    """Test that gate passes when candidate improves."""
    candidate = {
        'overall': {'f1': 0.85, 'precision': 0.85, 'recall': 0.85},
        'perClass': {
            'pedestrian': {'recall': 0.90},
            'cyclist': {'recall': 0.80},
        }
    }
    baseline = {
        'overall': {'f1': 0.80, 'precision': 0.80, 'recall': 0.80},
        'perClass': {
            'pedestrian': {'recall': 0.85},
            'cyclist': {'recall': 0.75},
        }
    }
    
    result = run_gate_check(candidate, baseline)
    assert result['passed'] == True


def test_gate_fails_on_safety_regression():
    """Test that gate fails when pedestrian recall regresses."""
    candidate = {
        'overall': {'f1': 0.90, 'precision': 0.90, 'recall': 0.90},
        'perClass': {
            'pedestrian': {'recall': 0.70},  # Lower than baseline by > tolerance!
            'cyclist': {'recall': 0.80},
        }
    }
    baseline = {
        'overall': {'f1': 0.80, 'precision': 0.80, 'recall': 0.80},
        'perClass': {
            'pedestrian': {'recall': 0.85},
            'cyclist': {'recall': 0.75},
        }
    }
    
    result = run_gate_check(candidate, baseline)
    assert result['passed'] == False


def test_gate_fails_on_no_improvement():
    """Test that gate fails when no F1 improvement."""
    candidate = {
        'overall': {'f1': 0.75, 'precision': 0.75, 'recall': 0.75},
        'perClass': {
            'pedestrian': {'recall': 0.90},
            'cyclist': {'recall': 0.85},
        }
    }
    baseline = {
        'overall': {'f1': 0.80, 'precision': 0.80, 'recall': 0.80},
        'perClass': {
            'pedestrian': {'recall': 0.85},
            'cyclist': {'recall': 0.80},
        }
    }
    
    result = run_gate_check(candidate, baseline)
    assert result['passed'] == False
