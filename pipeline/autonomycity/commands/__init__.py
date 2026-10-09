"""
Pipeline commands for the autonomycity CLI.
"""

from . import (
    validate, mine, label, qa, split,
    train_perception, train_policy, evaluate, gate, export,
    embed, search, compare, report
)

__all__ = [
    'validate', 'mine', 'label', 'qa', 'split',
    'train_perception', 'train_policy', 'evaluate', 'gate', 'export',
    'embed', 'search', 'compare', 'report'
]
