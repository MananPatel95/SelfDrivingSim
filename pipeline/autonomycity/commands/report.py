"""
Generate HTML report with metrics visualizations.
"""

import json
from pathlib import Path
from typing import Dict, Any, List
import argparse
from datetime import datetime


def generate_html_report(metrics: Dict[str, Any]) -> str:
    """Generate HTML report content."""
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AUTONOMY CITY - Metrics Report</title>
    <style>
        * {{ margin: 0; padding: 0; box-sizing: border-box; }}
        body {{ 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
        }}
        .container {{ max-width: 1200px; margin: 0 auto; padding: 20px; }}
        header {{
            background: linear-gradient(135deg, #0066cc, #004499);
            color: white;
            padding: 40px 20px;
            text-align: center;
        }}
        header h1 {{ font-size: 2.5em; margin-bottom: 10px; }}
        header p {{ opacity: 0.8; }}
        .section {{
            background: white;
            border-radius: 8px;
            padding: 20px;
            margin: 20px 0;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }}
        .section h2 {{
            color: #0066cc;
            margin-bottom: 15px;
            padding-bottom: 10px;
            border-bottom: 2px solid #eee;
        }}
        .metric-grid {{
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
        }}
        .metric-card {{
            background: #f8f9fa;
            border-radius: 8px;
            padding: 15px;
            text-align: center;
        }}
        .metric-value {{
            font-size: 2em;
            font-weight: bold;
            color: #0066cc;
        }}
        .metric-label {{
            font-size: 0.9em;
            color: #666;
            margin-top: 5px;
        }}
        table {{
            width: 100%;
            border-collapse: collapse;
            margin: 15px 0;
        }}
        th, td {{
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }}
        th {{
            background: #f8f9fa;
            font-weight: 600;
        }}
        tr:hover {{
            background: #f5f5f5;
        }}
        .bar {{
            height: 20px;
            background: #0066cc;
            border-radius: 4px;
        }}
        .bar-container {{
            background: #eee;
            border-radius: 4px;
            overflow: hidden;
        }}
        .disclaimer {{
            background: #fff3cd;
            border: 1px solid #ffc107;
            border-radius: 4px;
            padding: 15px;
            margin: 20px 0;
        }}
        footer {{
            text-align: center;
            padding: 20px;
            color: #666;
            font-size: 0.9em;
        }}
    </style>
</head>
<body>
    <header>
        <h1>AUTONOMY CITY</h1>
        <p>How Machines See - Metrics Report</p>
        <p>Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}</p>
    </header>
    
    <div class="container">
        <div class="disclaimer">
            <strong>Disclaimer:</strong> Simplified educational models based on public information. 
            Not affiliated with or endorsed by any company named. 
            These models are trained on simulated data and would not transfer to real-world applications without significant additional work.
        </div>
        
        <div class="section">
            <h2>Overview</h2>
            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-value">{metrics.get('totalModels', 0)}</div>
                    <div class="metric-label">Model Versions</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{metrics.get('totalSamples', 0):,}</div>
                    <div class="metric-label">Training Samples</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{metrics.get('gatesPassed', 0)}</div>
                    <div class="metric-label">Gates Passed</div>
                </div>
            </div>
        </div>
"""
    
    # Perception metrics
    if 'perception' in metrics:
        perc = metrics['perception']
        html += f"""
        <div class="section">
            <h2>Perception Model</h2>
            <table>
                <tr>
                    <th>Class</th>
                    <th>Precision</th>
                    <th>Recall</th>
                    <th>F1 Score</th>
                </tr>
"""
        for class_name, class_metrics in perc.get('perClass', {}).items():
            p = class_metrics.get('precision', 0)
            r = class_metrics.get('recall', 0)
            f1 = class_metrics.get('f1', 0)
            html += f"""
                <tr>
                    <td>{class_name}</td>
                    <td>{p:.3f}</td>
                    <td>{r:.3f}</td>
                    <td>{f1:.3f}</td>
                </tr>
"""
        html += """
            </table>
        </div>
"""
    
    # Policy metrics
    if 'policy' in metrics:
        pol = metrics['policy']
        html += f"""
        <div class="section">
            <h2>Policy Model</h2>
            <div class="metric-grid">
                <div class="metric-card">
                    <div class="metric-value">{pol.get('accelMAE', 0):.3f}</div>
                    <div class="metric-label">Acceleration MAE (m/s²)</div>
                </div>
                <div class="metric-card">
                    <div class="metric-value">{pol.get('steerMAE', 0):.3f}</div>
                    <div class="metric-label">Steering MAE</div>
                </div>
            </div>
        </div>
"""
    
    # Vendor quality
    if 'vendorQuality' in metrics:
        html += """
        <div class="section">
            <h2>Labeling Vendor Quality</h2>
            <table>
                <tr>
                    <th>Vendor</th>
                    <th>Pass Rate</th>
                    <th>Total Labeled</th>
                </tr>
"""
        for vendor, quality in metrics['vendorQuality'].items():
            rate = quality.get('passRate', 0)
            html += f"""
                <tr>
                    <td>{vendor}</td>
                    <td>
                        <div class="bar-container">
                            <div class="bar" style="width: {rate * 100}%"></div>
                        </div>
                        {rate:.1%}
                    </td>
                    <td>{quality.get('totalLabeled', 0):,}</td>
                </tr>
"""
        html += """
            </table>
        </div>
"""
    
    html += """
        <div class="section">
            <h2>Sim-to-Real Gap</h2>
            <p>These models are trained entirely on simulated data and would require significant additional work to transfer to real-world autonomous driving:</p>
            <ul style="margin: 15px 0; padding-left: 20px;">
                <li><strong>Sensor simulation fidelity:</strong> Real lidar, radar, and cameras have noise characteristics, artifacts, and failure modes not captured here.</li>
                <li><strong>Domain shift:</strong> Real-world scenes have vastly more variety in lighting, weather, object appearances, and road conditions.</li>
                <li><strong>Edge cases:</strong> The simulated scenarios cover only a tiny fraction of the challenging situations encountered in real driving.</li>
                <li><strong>Safety validation:</strong> Real autonomous systems require extensive real-world testing, formal verification, and regulatory approval.</li>
            </ul>
        </div>
    </div>
    
    <footer>
        <p>AUTONOMY CITY - Educational Autonomous Vehicle Simulation</p>
        <p>Simplified educational models based on public information. Not affiliated with or endorsed by any company named.</p>
    </footer>
</body>
</html>
"""
    return html


def run(args: argparse.Namespace) -> int:
    """Generate HTML report."""
    print(f"Generating report...")
    print(f"  Metrics: {args.metrics_dir}")
    print(f"  Output: {args.output}")
    
    metrics_dir = args.metrics_dir
    output_path = args.output
    
    if not metrics_dir.exists():
        print(f"Error: Metrics directory {metrics_dir} does not exist")
        return 1
    
    # Collect metrics from various sources
    metrics: Dict[str, Any] = {
        'totalModels': 0,
        'totalSamples': 0,
        'gatesPassed': 0,
    }
    
    # Load perception metrics
    perception_eval = metrics_dir / 'perception_v1' / 'eval.json'
    if perception_eval.exists():
        with open(perception_eval) as f:
            metrics['perception'] = json.load(f)
        metrics['totalModels'] += 1
    
    # Load perception metadata
    perception_meta = metrics_dir / 'perception_v1' / 'metadata.json'
    if perception_meta.exists():
        with open(perception_meta) as f:
            meta = json.load(f)
            metrics['totalSamples'] += meta.get('trainSamples', 0)
    
    # Load policy metrics
    policy_eval = metrics_dir / 'policy_v1' / 'eval.json'
    if policy_eval.exists():
        with open(policy_eval) as f:
            metrics['policy'] = json.load(f)
        metrics['totalModels'] += 1
    
    # Load gate results
    gate_result = metrics_dir / 'perception_v1' / 'gate.json'
    if gate_result.exists():
        with open(gate_result) as f:
            gate = json.load(f)
            if gate.get('passed', False):
                metrics['gatesPassed'] += 1
    
    # Generate HTML
    html = generate_html_report(metrics)
    
    # Save report
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, 'w') as f:
        f.write(html)
    
    print(f"\nReport generated!")
    print(f"  Output: {output_path}")
    
    return 0
