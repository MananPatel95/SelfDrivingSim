"""
Train perception model (PointNet-style classifier).
"""

import json
import random
import math
from pathlib import Path
from typing import Dict, Any, List, Tuple
import argparse

import numpy as np

# Lazy imports for PyTorch
torch = None
nn = None


def ensure_torch():
    """Lazy import PyTorch."""
    global torch, nn
    if torch is None:
        import torch as _torch
        import torch.nn as _nn
        torch = _torch
        nn = _nn


class PointNetClassifier(object):
    """Simple PointNet-style classifier for point cloud segments."""
    
    def __init__(self, num_classes: int = 7, num_points: int = 128, embed_dim: int = 64):
        ensure_torch()
        self.num_classes = num_classes
        self.num_points = num_points
        self.embed_dim = embed_dim
        
        self.model = nn.Sequential(
            # Per-point MLP
            nn.Linear(3, 64),
            nn.ReLU(),
            nn.Linear(64, 128),
            nn.ReLU(),
            nn.Linear(128, 256),
            nn.ReLU(),
        )
        
        self.classifier = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(128, embed_dim),
            nn.ReLU(),
            nn.Linear(embed_dim, num_classes),
        )
    
    def forward(self, x):
        """Forward pass. x: (batch, num_points, 3)"""
        batch_size = x.shape[0]
        
        # Per-point features
        x = self.model(x)  # (batch, num_points, 256)
        
        # Global max pooling
        x = torch.max(x, dim=1)[0]  # (batch, 256)
        
        # Classification
        logits = self.classifier(x)  # (batch, num_classes)
        
        return logits
    
    def get_embedding(self, x):
        """Get embedding for similarity search."""
        batch_size = x.shape[0]
        x = self.model(x)
        x = torch.max(x, dim=1)[0]
        
        # Get embedding from classifier's middle layer
        x = self.classifier[0](x)
        x = self.classifier[1](x)
        x = self.classifier[2](x)
        x = self.classifier[3](x)
        return x  # (batch, embed_dim)
    
    def parameters(self):
        """Get all parameters."""
        return list(self.model.parameters()) + list(self.classifier.parameters())
    
    def train_mode(self):
        self.model.train()
        self.classifier.train()
    
    def eval_mode(self):
        self.model.eval()
        self.classifier.eval()
    
    def state_dict(self):
        return {
            'model': self.model.state_dict(),
            'classifier': self.classifier.state_dict(),
        }
    
    def load_state_dict(self, state_dict):
        self.model.load_state_dict(state_dict['model'])
        self.classifier.load_state_dict(state_dict['classifier'])


CLASS_NAMES = ['car', 'truck', 'bus', 'pedestrian', 'cyclist', 'bicycle', 'motorcycle']
CLASS_TO_IDX = {name: i for i, name in enumerate(CLASS_NAMES)}


def prepare_sample(label: Dict[str, Any], num_points: int = 128) -> Tuple[np.ndarray, int]:
    """
    Prepare a training sample from a label.
    Simulates extracting points from the bounding box.
    """
    box = label.get('boundingBox', {})
    center = box.get('center', {})
    size = box.get('size', {})
    yaw = box.get('yaw', 0)
    
    # Generate synthetic points within the box
    points = []
    for _ in range(num_points):
        # Random point in unit box
        x = random.uniform(-0.5, 0.5) * size.get('x', 1)
        y = random.uniform(-0.5, 0.5) * size.get('y', 1)
        z = random.uniform(-0.5, 0.5) * size.get('z', 1)
        
        # Rotate by yaw
        x_rot = x * math.cos(yaw) - y * math.sin(yaw)
        y_rot = x * math.sin(yaw) + y * math.cos(yaw)
        
        # Normalize to center at origin
        points.append([x_rot, y_rot, z])
    
    class_type = label.get('classType', 'car')
    class_idx = CLASS_TO_IDX.get(class_type, 0)
    
    return np.array(points, dtype=np.float32), class_idx


def load_dataset(split_path: Path, num_points: int = 128) -> List[Tuple[np.ndarray, int]]:
    """Load dataset from split directory."""
    frames_file = split_path / 'frames.json'
    
    if not frames_file.exists():
        return []
    
    with open(frames_file) as f:
        frames = json.load(f)
    
    samples = []
    for frame in frames:
        for label in frame.get('vendorLabels', []):
            class_type = label.get('classType', '')
            if class_type in CLASS_TO_IDX:
                points, class_idx = prepare_sample(label, num_points)
                samples.append((points, class_idx))
    
    return samples


def run(args: argparse.Namespace) -> int:
    """Run perception model training."""
    ensure_torch()
    
    print(f"Training perception model...")
    print(f"  Dataset: {args.dataset}")
    print(f"  Output: {args.output}")
    print(f"  Epochs: {args.epochs}")
    print(f"  Batch size: {args.batch_size}")
    print(f"  Learning rate: {args.lr}")
    
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
    model = PointNetClassifier(num_classes=len(CLASS_NAMES))
    optimizer = torch.optim.Adam(model.parameters(), lr=args.lr)
    criterion = nn.CrossEntropyLoss()
    
    # Training loop
    best_val_acc = 0
    history = {'train_loss': [], 'train_acc': [], 'val_acc': []}
    
    for epoch in range(args.epochs):
        model.train_mode()
        
        # Shuffle training data
        random.shuffle(train_data)
        
        epoch_loss = 0
        correct = 0
        total = 0
        
        # Mini-batches
        for i in range(0, len(train_data), args.batch_size):
            batch = train_data[i:i + args.batch_size]
            if not batch:
                continue
            
            points = torch.tensor(np.array([s[0] for s in batch]))
            labels = torch.tensor([s[1] for s in batch])
            
            optimizer.zero_grad()
            logits = model.forward(points)
            loss = criterion(logits, labels)
            loss.backward()
            optimizer.step()
            
            epoch_loss += loss.item() * len(batch)
            predictions = torch.argmax(logits, dim=1)
            correct += (predictions == labels).sum().item()
            total += len(batch)
        
        train_loss = epoch_loss / total
        train_acc = correct / total
        history['train_loss'].append(train_loss)
        history['train_acc'].append(train_acc)
        
        # Validation
        model.eval_mode()
        val_correct = 0
        val_total = 0
        
        with torch.no_grad():
            for i in range(0, len(val_data), args.batch_size):
                batch = val_data[i:i + args.batch_size]
                if not batch:
                    continue
                
                points = torch.tensor(np.array([s[0] for s in batch]))
                labels = torch.tensor([s[1] for s in batch])
                
                logits = model.forward(points)
                predictions = torch.argmax(logits, dim=1)
                val_correct += (predictions == labels).sum().item()
                val_total += len(batch)
        
        val_acc = val_correct / val_total if val_total > 0 else 0
        history['val_acc'].append(val_acc)
        
        if val_acc > best_val_acc:
            best_val_acc = val_acc
            torch.save(model.state_dict(), output_path / 'model_best.pt')
        
        if (epoch + 1) % 10 == 0:
            print(f"  Epoch {epoch + 1}: loss={train_loss:.4f}, train_acc={train_acc:.3f}, val_acc={val_acc:.3f}")
    
    # Save final model
    torch.save(model.state_dict(), output_path / 'model_final.pt')
    
    # Save training history and metadata
    metadata = {
        'numClasses': len(CLASS_NAMES),
        'classNames': CLASS_NAMES,
        'numPoints': 128,
        'embedDim': 64,
        'trainSamples': len(train_data),
        'valSamples': len(val_data),
        'epochs': args.epochs,
        'batchSize': args.batch_size,
        'lr': args.lr,
        'bestValAcc': best_val_acc,
        'history': history,
    }
    
    with open(output_path / 'metadata.json', 'w') as f:
        json.dump(metadata, f, indent=2)
    
    print(f"\nTraining complete!")
    print(f"  Best validation accuracy: {best_val_acc:.3f}")
    print(f"  Model saved to: {output_path}")
    
    return 0
