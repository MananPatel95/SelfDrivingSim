"""
Gate check for model promotion.
Only promotes if metrics improve and safety metrics don't regress.
"""

import json
from pathlib import Path
from typing import Dict, Any
import argparse


def run(args: argparse.Namespace) -> int:
    """Run gate check."""
    print(f"Running gate check...")
    print(f"  Candidate: {args.candidate}")
    print(f"  Baseline: {args.baseline}")
    
    candidate_path = args.candidate
    baseline_path = args.baseline
    output_path = args.output
    
    if not candidate_path.exists():
        print(f"Error: Candidate file {candidate_path} does not exist")
        return 1
    
    # Load candidate metrics
    with open(candidate_path) as f:
        candidate = json.load(f)
    
    # Load or create baseline
    if baseline_path.exists():
        with open(baseline_path) as f:
            baseline = json.load(f)
    else:
        # Create default baseline
        baseline = {
            'modelType': candidate.get('modelType', 'perception'),
            'overall': {'f1': 0.0, 'precision': 0.0, 'recall': 0.0},
            'perClass': {
                'pedestrian': {'recall': 0.0}
            }
        }
    
    # Gate criteria
    gate_result = {
        'passed': True,
        'checks': [],
        'candidate': str(candidate_path),
        'baseline': str(baseline_path),
    }
    
    model_type = candidate.get('modelType', 'perception')
    
    if model_type == 'perception':
        # Check overall F1 improvement
        candidate_f1 = candidate.get('overall', {}).get('f1', 0)
        baseline_f1 = baseline.get('overall', {}).get('f1', 0)
        f1_improved = candidate_f1 >= baseline_f1
        
        gate_result['checks'].append({
            'name': 'overall_f1',
            'passed': f1_improved,
            'candidate': candidate_f1,
            'baseline': baseline_f1,
            'message': f"Overall F1: {candidate_f1:.3f} vs baseline {baseline_f1:.3f}"
        })
        
        if not f1_improved:
            gate_result['passed'] = False
        
        # Safety check: pedestrian recall must not regress
        candidate_ped_recall = candidate.get('perClass', {}).get('pedestrian', {}).get('recall', 0)
        baseline_ped_recall = baseline.get('perClass', {}).get('pedestrian', {}).get('recall', 0)
        tolerance = 0.02  # Allow 2% regression
        
        ped_recall_ok = candidate_ped_recall >= baseline_ped_recall - tolerance
        
        gate_result['checks'].append({
            'name': 'pedestrian_recall_safety',
            'passed': ped_recall_ok,
            'candidate': candidate_ped_recall,
            'baseline': baseline_ped_recall,
            'tolerance': tolerance,
            'message': f"Pedestrian recall: {candidate_ped_recall:.3f} vs baseline {baseline_ped_recall:.3f} (tolerance={tolerance})"
        })
        
        if not ped_recall_ok:
            gate_result['passed'] = False
        
        # Check cyclist recall (safety critical)
        candidate_cyc_recall = candidate.get('perClass', {}).get('cyclist', {}).get('recall', 0)
        baseline_cyc_recall = baseline.get('perClass', {}).get('cyclist', {}).get('recall', 0)
        
        cyc_recall_ok = candidate_cyc_recall >= baseline_cyc_recall - tolerance
        
        gate_result['checks'].append({
            'name': 'cyclist_recall_safety',
            'passed': cyc_recall_ok,
            'candidate': candidate_cyc_recall,
            'baseline': baseline_cyc_recall,
            'tolerance': tolerance,
            'message': f"Cyclist recall: {candidate_cyc_recall:.3f} vs baseline {baseline_cyc_recall:.3f}"
        })
        
        if not cyc_recall_ok:
            gate_result['passed'] = False
    
    elif model_type == 'policy':
        # Check action MSE improvement
        candidate_mse = candidate.get('actionMSE', float('inf'))
        baseline_mse = baseline.get('actionMSE', float('inf'))
        
        mse_improved = candidate_mse <= baseline_mse
        
        gate_result['checks'].append({
            'name': 'action_mse',
            'passed': mse_improved,
            'candidate': candidate_mse,
            'baseline': baseline_mse,
            'message': f"Action MSE: {candidate_mse:.4f} vs baseline {baseline_mse:.4f}"
        })
        
        if not mse_improved:
            gate_result['passed'] = False
    
    # Save result
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(gate_result, f, indent=2)
    
    # Print result
    status = "PASSED" if gate_result['passed'] else "FAILED"
    print(f"\nGate check: {status}")
    
    for check in gate_result['checks']:
        check_status = "✓" if check['passed'] else "✗"
        print(f"  {check_status} {check['name']}: {check['message']}")
    
    print(f"\nResult saved to: {output_path}")
    
    return 0 if gate_result['passed'] else 1
