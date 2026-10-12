---
tags: [system]
updated: 2026-10-12
sources: [1]
---

# Data engine

Python package under `pipeline/`. Headless `npm run simulate` writes recordings; `make loop` mines, labels (vendor noise), QA, splits by scenario seed, trains perception and policy, evaluates, gates, and can export ONNX.

Checkpoint A is described in `CHECKPOINT_A.md` and `docs/data_schema.md`.

## Key files

- `pipeline/`
- `CHECKPOINT_A.md`
- `docs/data_schema.md`
- `Makefile`
