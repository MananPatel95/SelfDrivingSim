#!/usr/bin/env python3
"""
CLI entry point for the autonomycity data pipeline.

Commands:
  validate    - Validate recordings against schema
  mine        - Mine interesting frames (disengagements, errors, near-misses)
  label       - Generate labels with simulated vendor noise
  qa          - Quality assurance on labels
  split       - Create train/val/test splits
  train-perception - Train perception model
  train-policy     - Train planning policy (DAgger)
  eval        - Evaluate models
  gate        - Gate check for model promotion
  export      - Export models to ONNX
  embed       - Generate embeddings for similarity search
  search      - Search for similar frames
  compare     - Compare sensor modalities
  report      - Generate HTML report
"""

import argparse
import sys
from pathlib import Path
from typing import List, Optional

from autonomycity.commands import (
    validate, mine, label, qa, split,
    train_perception, train_policy, evaluate, gate, export,
    embed, search, compare, report
)


def create_parser() -> argparse.ArgumentParser:
    """Create the CLI argument parser."""
    parser = argparse.ArgumentParser(
        prog="autonomycity",
        description="Data pipeline for Autonomy City autonomous vehicle simulation"
    )
    parser.add_argument(
        "--data-dir",
        type=Path,
        default=Path("data"),
        help="Path to data directory"
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=Path("models"),
        help="Path to models directory"
    )
    parser.add_argument(
        "--verbose", "-v",
        action="store_true",
        help="Verbose output"
    )
    
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # validate
    p_validate = subparsers.add_parser("validate", help="Validate recordings against schema")
    p_validate.add_argument("recordings", type=Path, nargs="+", help="Recording paths")
    
    # mine
    p_mine = subparsers.add_parser("mine", help="Mine interesting frames")
    p_mine.add_argument("--recordings-dir", type=Path, required=True)
    p_mine.add_argument("--output", type=Path, required=True)
    p_mine.add_argument("--triggers", nargs="+", default=["all"])
    
    # label
    p_label = subparsers.add_parser("label", help="Generate labels")
    p_label.add_argument("--input", type=Path, required=True)
    p_label.add_argument("--output", type=Path, required=True)
    p_label.add_argument("--vendor-noise", type=float, default=0.0)
    p_label.add_argument("--vendor-id", type=str, default="auto")
    
    # qa
    p_qa = subparsers.add_parser("qa", help="QA on labels")
    p_qa.add_argument("--input", type=Path, required=True)
    p_qa.add_argument("--output", type=Path, required=True)
    p_qa.add_argument("--taxonomy", type=Path, required=True)
    
    # split
    p_split = subparsers.add_parser("split", help="Create train/val/test splits")
    p_split.add_argument("--input", type=Path, required=True)
    p_split.add_argument("--output", type=Path, required=True)
    p_split.add_argument("--train-ratio", type=float, default=0.7)
    p_split.add_argument("--val-ratio", type=float, default=0.15)
    p_split.add_argument("--benchmark-seeds", type=Path, help="Frozen benchmark seeds")
    
    # train-perception
    p_train_perc = subparsers.add_parser("train-perception", help="Train perception model")
    p_train_perc.add_argument("--dataset", type=Path, required=True)
    p_train_perc.add_argument("--output", type=Path, required=True)
    p_train_perc.add_argument("--epochs", type=int, default=50)
    p_train_perc.add_argument("--batch-size", type=int, default=32)
    p_train_perc.add_argument("--lr", type=float, default=0.001)
    
    # train-policy
    p_train_pol = subparsers.add_parser("train-policy", help="Train planning policy")
    p_train_pol.add_argument("--dataset", type=Path, required=True)
    p_train_pol.add_argument("--output", type=Path, required=True)
    p_train_pol.add_argument("--epochs", type=int, default=100)
    p_train_pol.add_argument("--batch-size", type=int, default=64)
    p_train_pol.add_argument("--lr", type=float, default=0.0001)
    
    # eval
    p_eval = subparsers.add_parser("eval", help="Evaluate models")
    p_eval.add_argument("--model", type=Path, required=True)
    p_eval.add_argument("--benchmark", type=Path, required=True)
    p_eval.add_argument("--output", type=Path, required=True)
    p_eval.add_argument("--model-type", choices=["perception", "policy"], required=True)
    
    # gate
    p_gate = subparsers.add_parser("gate", help="Gate check for model promotion")
    p_gate.add_argument("--candidate", type=Path, required=True)
    p_gate.add_argument("--baseline", type=Path, required=True)
    p_gate.add_argument("--output", type=Path, required=True)
    
    # export
    p_export = subparsers.add_parser("export", help="Export models to ONNX")
    p_export.add_argument("--model", type=Path, required=True)
    p_export.add_argument("--output", type=Path, required=True)
    p_export.add_argument("--model-type", choices=["perception", "policy"], required=True)
    
    # embed
    p_embed = subparsers.add_parser("embed", help="Generate embeddings")
    p_embed.add_argument("--model", type=Path, required=True)
    p_embed.add_argument("--data", type=Path, required=True)
    p_embed.add_argument("--output", type=Path, required=True)
    
    # search
    p_search = subparsers.add_parser("search", help="Search for similar frames")
    p_search.add_argument("--query", type=Path, required=True)
    p_search.add_argument("--embeddings", type=Path, required=True)
    p_search.add_argument("--top-k", type=int, default=10)
    
    # compare
    p_compare = subparsers.add_parser("compare", help="Compare sensor modalities")
    p_compare.add_argument("--recordings-dir", type=Path, required=True)
    p_compare.add_argument("--output", type=Path, required=True)
    
    # report
    p_report = subparsers.add_parser("report", help="Generate HTML report")
    p_report.add_argument("--metrics-dir", type=Path, required=True)
    p_report.add_argument("--output", type=Path, required=True)
    
    return parser


def main(argv: Optional[List[str]] = None) -> int:
    """Main entry point."""
    parser = create_parser()
    args = parser.parse_args(argv)
    
    if args.command is None:
        parser.print_help()
        return 1
    
    commands = {
        "validate": validate.run,
        "mine": mine.run,
        "label": label.run,
        "qa": qa.run,
        "split": split.run,
        "train-perception": train_perception.run,
        "train-policy": train_policy.run,
        "eval": evaluate.run,
        "gate": gate.run,
        "export": export.run,
        "embed": embed.run,
        "search": search.run,
        "compare": compare.run,
        "report": report.run,
    }
    
    try:
        return commands[args.command](args)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
