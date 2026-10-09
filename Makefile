# AUTONOMY CITY Makefile
# Top-level build targets for the simulation and data pipeline

.PHONY: all dev build test sample-data loop clean install help

# Default target
all: install test build

# Install dependencies
install:
	@echo "Installing game dependencies..."
	cd game && npm install
	@echo "Installing pipeline dependencies..."
	cd pipeline && pip install -e ".[dev]"

# Development server
dev:
	cd game && npm run dev

# Build game for production
build:
	@echo "Building game..."
	cd game && npm run build
	@echo "Build complete!"

# Run all tests
test:
	@echo "Running TypeScript tests..."
	cd game && npm test
	@echo "Running Python tests..."
	cd pipeline && pytest
	@echo "All tests passed!"

# Generate sample data from headless simulation
sample-data:
	@echo "Generating sample data..."
	@mkdir -p data/recordings
	cd game && npm run simulate -- \
		--profile baseline_lidar \
		--scenarios all \
		--seeds 1-5 \
		--seconds 60 \
		--oracle-supervisor \
		--output ../data/recordings
	@echo "Sample data generation complete!"

# Run the full data engine loop (Checkpoint A)
loop: sample-data
	@echo "Running data engine loop..."
	@echo "Step 1: Mining interesting frames..."
	autonomycity mine \
		--recordings-dir data/recordings \
		--output data/mined
	@echo "Step 2: Generating labels with vendor noise..."
	autonomycity label \
		--input data/mined \
		--output data/labeled \
		--vendor-noise 0.05 \
		--vendor-id vendor_a
	@echo "Step 3: QA on labels..."
	autonomycity qa \
		--input data/labeled \
		--output data/qa_passed \
		--taxonomy data/taxonomy/taxonomy.yaml
	@echo "Step 4: Creating train/val/test splits..."
	autonomycity split \
		--input data/qa_passed \
		--output data/splits \
		--benchmark-seeds data/taxonomy/benchmark_seeds.json
	@echo "Step 5: Training perception model v1..."
	autonomycity train-perception \
		--dataset data/splits \
		--output models/perception_v1 \
		--epochs 50
	@echo "Step 6: Evaluating perception model..."
	autonomycity eval \
		--model models/perception_v1 \
		--benchmark data/splits/benchmark \
		--output models/perception_v1/eval.json \
		--model-type perception
	@echo "Step 7: Training policy model v1..."
	autonomycity train-policy \
		--dataset data/splits \
		--output models/policy_v1 \
		--epochs 100
	@echo "Step 8: Evaluating policy model..."
	autonomycity eval \
		--model models/policy_v1 \
		--benchmark data/splits/benchmark \
		--output models/policy_v1/eval.json \
		--model-type policy
	@echo "Step 9: Gate check..."
	autonomycity gate \
		--candidate models/perception_v1/eval.json \
		--baseline data/baseline_metrics.json \
		--output models/perception_v1/gate.json
	@echo "Step 10: DAgger iteration for perception v2..."
	autonomycity dagger \
		--model models/perception_v1 \
		--dataset data/splits \
		--output models/dagger_perception \
		--model-type perception \
		--episodes 5
	@echo "Step 11: Evaluating perception v2..."
	autonomycity eval \
		--model models/dagger_perception/perception_v2 \
		--benchmark data/splits/benchmark \
		--output models/dagger_perception/perception_v2/eval.json \
		--model-type perception
	@echo "Step 12: Gate check v2 vs v1..."
	autonomycity gate \
		--candidate models/dagger_perception/perception_v2/eval.json \
		--baseline models/perception_v1/eval.json \
		--output models/dagger_perception/perception_v2/gate.json
	@echo "Step 13: DAgger iteration for policy v2..."
	autonomycity dagger \
		--model models/policy_v1 \
		--dataset data/splits \
		--output models/dagger_policy \
		--model-type policy \
		--episodes 5
	@echo "Step 14: Evaluating policy v2..."
	autonomycity eval \
		--model models/dagger_policy/policy_v2 \
		--benchmark data/splits/benchmark \
		--output models/dagger_policy/policy_v2/eval.json \
		--model-type policy
	@echo "Step 15: Exporting to ONNX..."
	autonomycity export \
		--model models/perception_v1 \
		--output models/perception_v1.onnx \
		--model-type perception
	autonomycity export \
		--model models/dagger_perception/perception_v2 \
		--output models/perception_v2.onnx \
		--model-type perception
	autonomycity export \
		--model models/policy_v1 \
		--output models/policy_v1.onnx \
		--model-type policy
	autonomycity export \
		--model models/dagger_policy/policy_v2 \
		--output models/policy_v2.onnx \
		--model-type policy
	@echo "Step 16: Generating report..."
	autonomycity report \
		--metrics-dir models \
		--output data/reports/report.html
	@echo "Data engine loop complete! (v1 + v2 models created)"

# Run validation on recordings
validate:
	autonomycity validate data/recordings/*

# Compare sensor modalities
compare:
	autonomycity compare \
		--recordings-dir data/recordings \
		--output data/reports/modality_comparison.html

# Generate HTML report
report:
	autonomycity report \
		--metrics-dir models \
		--output data/reports/report.html

# Clean build artifacts
clean:
	rm -rf game/dist game/node_modules/.vite
	rm -rf pipeline/*.egg-info pipeline/__pycache__
	rm -rf data/mined data/labeled data/qa_passed data/splits
	rm -rf models/*.onnx
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true

# Help
help:
	@echo "AUTONOMY CITY Makefile"
	@echo ""
	@echo "Targets:"
	@echo "  install      Install all dependencies"
	@echo "  dev          Start development server"
	@echo "  build        Build game for production"
	@echo "  test         Run all tests (Vitest + pytest)"
	@echo "  sample-data  Generate sample recordings from headless sim"
	@echo "  loop         Run full data engine loop (mine->train->eval->gate)"
	@echo "  validate     Validate recordings against schema"
	@echo "  compare      Compare sensor modalities across profiles"
	@echo "  report       Generate HTML metrics report"
	@echo "  clean        Remove build artifacts"
	@echo "  help         Show this help"
