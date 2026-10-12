# AUTONOMY CITY — agent notes

This repo is a browser 3D self-driving city (`game/`) plus a Python data engine (`pipeline/`). The LLM-owned wiki lives in `wiki/` and is the first place to read before changing code.

## Wiki layout (Karpathy LLM Wiki)

Three layers:

1. **Raw sources (immutable).** Do not edit these as part of a wiki ingest. Cite them by path or PR number:
   - Code: `game/src/`, `game/crates/autonomy-sim/`, `pipeline/`, `Makefile`
   - Merged PR descriptions and diffs on GitHub (`#1` … latest)
   - `README.md`, `CHECKPOINT_A.md`, `docs/`
   - Screenshots in `docs/screenshots/`
2. **Wiki (`wiki/`).** Interlinked markdown owned by agents. Every page has YAML frontmatter (`tags`, `updated`, `sources`) and a **Key files** section with real paths. Use `[[wikilinks]]` or relative `.md` links so the tree works in Obsidian.
3. **This file.** Schema and the three workflows below.

### Pages

| Path | Role |
| --- | --- |
| `wiki/index.md` | Catalog of every page, grouped by systems / concepts / entities / decisions / sources |
| `wiki/log.md` | Append-only. Every entry starts `## [YYYY-MM-DD] ingest \| PR #N <title>` (or `lint \|`, `query \|`) |
| `wiki/overview.md` | What the project is right now |
| `wiki/decisions.md` | Durable choices (F4/F5/F6 removal, Rust/WASM scope, …) |
| `wiki/systems/*.md` | How a subsystem works |
| `wiki/concepts/*.md` | Ideas that cut across files |
| `wiki/entities/*.md` | Key modules / crates |
| `wiki/sources/pr-NNN.md` | One page per merged PR: what changed, why, pages touched, claims superseded |

### Conventions

- Only write facts that are true in the current code. If a newer PR replaced behaviour, say so on both the old `pr-NNN` page and the live system page.
- `sources: [3, 18]` lists PR numbers, not file paths.
- `updated:` is an ISO date.
- After editing wiki pages, run `python3 scripts/wiki_lint.py`.

## Workflows

### Ingest (required on every PR that changes behaviour)

1. Update the affected system / concept / entity pages.
2. Add `wiki/sources/pr-NNN.md` for this PR (use the GitHub number once it exists; while drafting, use the branch name in the log and fix the number when the PR opens).
3. Add the new page to `wiki/index.md`.
4. Append a log line: `## [YYYY-MM-DD] ingest | PR #N <title>`
5. If the change is a decision (scope, architecture), update `wiki/decisions.md`.

Bypass the CI “wiki must change” check with the `no-wiki` label only for pure chores (typo-only, lockfile, screenshot retakes with no behaviour change).

### Query

1. Read `wiki/index.md` first.
2. Open the listed pages; answer with citations (`wiki/systems/…`, `game/src/…`, `PR #N`).
3. If the answer is reusable, file it back as a page and log `## [YYYY-MM-DD] query | <short topic>`.

### Lint

```bash
python3 scripts/wiki_lint.py
```

Checks: missing frontmatter, broken `[[wikilinks]]` / relative links, pages missing from `index.md`, **Key files** paths that do not exist. `.github/workflows/wiki.yml` runs this on pull_request and fails if `game/` or `pipeline/` (or other source roots) changed while `wiki/` did not, unless the PR has `no-wiki`.

## How to run the project

- `make dev` — rebuild WASM then Vite
- `cd game && npm run dev` — game only (committed `pkg/` is enough)
- `cd game && npm test` — Vitest
- `make test` — Vitest + pytest
