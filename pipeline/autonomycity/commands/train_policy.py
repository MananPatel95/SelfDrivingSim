"""
Train planning policy via behavior cloning / DAgger.
"""

import json
import random
import math
from pathlib import Path
from typing import Dict, Any, List, Tuple
import argparse

import numpy as np

torch = None
nn = None


def ensure_torch():
    global torch, nn
    if torch is None:
        import torch as _torch
        import torch.nn as _nn
        torch = _torch
        nn = _nn


class PolicyNetwork(object):
    """Simple MLP policy for behavior cloning."""
    
    def __init__(self, state_dim: int = 64, action_dim: int = 2):
        ensure_torch()
        self.state_dim = state_dim
        self.action_dim = action_dim
        
        self.network = nn.Sequential(
            nn.Linear(state_dim, 128),
            nn.ReLU(),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, action_dim),
            nn.Tanh(),  # Actions in [-1, 1]
        )
    
    def forward(self, x):
        return self.network(x)
    
    def parameters(self):
        return self.network.parameters()
    
    def train_mode(self):
        self.network.train()
    
    def eval_mode(self):
        self.network.eval()
    
    def state_dict(self):
        return self.network.state_dict()
    
    def load_state_dict(self, state_dict):
        self.network.load_state_dict(state_dict)


def extract_state_features(frame: Dict[str, Any]) -> np.ndarray:
    """
    Extract state features from a frame.
    Features: ego speed, lane offset, heading error, nearby occupancy grid.
    """
    ego = frame.get('egoState', {})
    
    # Ego speed
    velocity = ego.get('velocity', {})
    speed = math.sqrt(velocity.get('x', 0)**2 + velocity.get('y', 0)**2)
    
    # Steering and throttle
    steering = ego.get('steering', 0)
    throttle = ego.get('throttle', 0)
    
    # Stopping distance
    stopping_dist = ego.get('stoppingDistance', 0)
    
    # Basic features (would be expanded with proper BEV occupancy)
    features = [
        speed / 30.0,  # Normalized speed
        steering,
        throttle,
        min(stopping_dist / 50.0, 1.0),  # Normalized stopping dist
    ]
    
    # Add placeholder for BEV occupancy (8x8 grid = 64 values)
    # In full implementation, this would be the actual occupancy grid
    bev_occupancy = np.zeros(60).tolist()
    features.extend(bev_occupancy)
    
    return np.array(features, dtype=np.float32)


def extract_action(frame: Dict[str, Any]) -> np.ndarray:
    """Extract action (acceleration, steering) from planner output."""
    planner_output = frame.get('plannerOutput', {})
    
    accel = planner_output.get('acceleration', 0)
    steering = planner_output.get('steering', 0)
    
    # Normalize to [-1, 1]
    accel_norm = max(-1, min(1, accel / 4.0))  # Assuming max accel = 4 m/s^2
    steering_norm = max(-1, min(1, steering))
    
    return np.array([accel_norm, steering_norm], dtype=np.float32)


def load_dataset(split_path: Path) -> List[Tuple[np.ndarray, np.ndarray]]:
    """Load dataset for policy training."""
    frames_file = split_path / 'frames.json'
    
    if not frames_file.exists():
        return []
    
    with open(frames_file) as f:
        frames = json.load(f)
    
    samples = []
    for frame in frames:
        # Only use frames where oracle or human took over
        # (these are the "expert" demonstrations)
        control_source = frame.get('controlSource', 'policy')
        
        state = extract_state_features(frame)
        action = extract_action(frame)
        samples.append((state, action))
    
    return samples


def run(args: argparse.Namespace) -> int:
    """Run policy training."""
    ensure_torch()
    
    print(f"Training policy model...")
    print(f"  Dataset: {args.dataset}")
    print(f"  Output: {args.output}")
    print(f"  Epochs: {args.epochs}")
    
    dataset_path = args.dataset
    output_path = args.output
    
    if not dataset_path.exists():
        print(f"Error: Dataset path {dataset_path} does not exist")
        return 1
    
    output_path.mkdir(parents=True, exist_ok=True)
    
    # Load data
    print("\nLoading data...")
    train_data = load_dataset(dataset_path / 'train')
    val_data = load_dataset(dataset_path / 'val')
    
    if not train_data:
        print("Error: No training data found")
        return 1
    
    print(f"  Train samples: {len(train_data)}")
    print(f"  Val samples: {len(val_data)}")
    
    # Create model
    model = PolicyNetwork(state_dim=64, action_dim=2)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    criterion = nn.MSELoss()
    
    # Training loop
    best_val_loss = float('inf')
    history = {'train_loss': [], 'val_loss': []}
    
    for epoch in range(args.epochs):
        model.train_mode()
        random.shuffle(train_data)
        
        epoch_loss = 0
        total = 0
        
        for i in range(0, len(train_data), args.batch_size):
            batch = train_data[i:i + args.batch_size]
            if not batch:
                continue
            
            states = torch.tensor(np.array([s[0] for s in batch]))
            actions = torch.tensor(np.array([s[1] for s in batch]))
            
            optimizer.zero_grad()
            predicted = model.forward(states)
            loss = criterion(predicted, actions)
            loss.backward()
            optimizer.step()
            
            epoch_loss += loss.item() * len(batch)
            total += len(batch)
        
        train_loss = epoch_loss / total
        history['train_loss'].append(train_loss)
        
        # Validation
        model.eval_mode()
        val_loss = 0
        val_total = 0
        
        with torch.no_grad():
            for i in range(0, len(val_data), args.batch_size):
                batch = val_data[i:i + args.batch_size]
                if not batch:
                    continue
                
                states = torch.tensor(np.array([s[0] for s in batch]))
                actions = torch.tensor(np.array([s[1] for s in batch]))
                
                predicted = model.forward(states)
                loss = criterion(predicted, actions)
                val_loss += loss.item() * len(batch)
                val_total += len(batch)
        
        val_loss = val_loss / val_total if val_total > 0 else 0
        history['val_loss'].append(val_loss)
        
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            torch.save(model.state_dict(), output_path / 'model_best.pt')
        
        if (epoch + 1) % 20 == 0:
            print(f"  Epoch {epoch + 1}: train_loss={train_loss:.4f}, val_loss={val_loss:.4f}")
    
    # Save final model
    torch.save(model.state_dict(), output_path / 'model_final.pt')
    
    # Save metadata
    metadata = {
        'stateDim': 64,
        'actionDim': 2,
        'trainSamples': len(train_data),
        'valSamples': len(val_data),
        'epochs': args.epochs,
        'batchSize': args.batch_size,
        'lr': args.lr,
        'bestValLoss': best_val_loss,
        'history': history,
    }
    
    with open(output_path / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"\nTraining complete!")
    print(f"  Best validation loss: {best_val_loss:.4f}")
    print(f"  Model saved to: {output_path}")
    
    return 0
