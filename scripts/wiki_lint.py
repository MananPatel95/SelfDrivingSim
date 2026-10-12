#!/usr/bin/env python3
"""Lint the LLM wiki: frontmatter, links, orphans, Key files paths."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WIKI = ROOT / "wiki"
INDEX = WIKI / "index.md"

FM_RE = re.compile(r"^---\n(.*?)\n---\n", re.S)
LINK_RE = re.compile(r"\[\[([^\]]+)\]\]|\]\(([^)]+\.md)\)")
KEY_RE = re.compile(r"`([^`]+)`")


def fail(msg: str) -> None:
    print(f"wiki_lint: {msg}", file=sys.stderr)
    raise SystemExit(1)


def pages() -> list[Path]:
    if not WIKI.is_dir():
        fail("wiki/ is missing")
    return sorted(p for p in WIKI.rglob("*.md") if p.is_file())


def stem_map(files: list[Path]) -> dict[str, Path]:
    out: dict[str, Path] = {}
    for p in files:
        out[p.stem] = p
        out[str(p.relative_to(WIKI)).replace("\\", "/")] = p
        out[str(p.relative_to(WIKI).with_suffix("")).replace("\\", "/")] = p
    return out


def parse_frontmatter(text: str, path: Path) -> dict[str, str]:
    m = FM_RE.match(text)
    if not m:
        fail(f"{path.relative_to(ROOT)}: missing YAML frontmatter")
    raw = m.group(1)
    data: dict[str, str] = {}
    for line in raw.splitlines():
        if ":" not in line:
            continue
        k, v = line.split(":", 1)
        data[k.strip()] = v.strip()
    for key in ("tags", "updated", "sources"):
        if key not in data:
            fail(f"{path.relative_to(ROOT)}: frontmatter missing {key}")
    return data


def index_listed(index_text: str) -> set[str]:
    found = set()
    for m in re.finditer(r"\(([^)]+\.md)\)", index_text):
        found.add(m.group(1).lstrip("./"))
    for m in re.finditer(r"\[\[([^\]]+)\]\]", index_text):
        found.add(m.group(1).split("|")[0].strip())
    return found


def resolve_link(target: str, stems: dict[str, Path], src: Path) -> bool:
    t = target.split("|")[0].strip()
    if t in stems:
        return True
    rel = (src.parent / t).resolve()
    try:
        rel.relative_to(WIKI.resolve())
    except ValueError:
        return False
    return rel.is_file()


def check_key_files(text: str, path: Path) -> None:
    if "## Key files" not in text and "## Key files" not in text.replace("Files", "files"):
        if path.name in {"index.md", "log.md"}:
            return
        fail(f"{path.relative_to(ROOT)}: missing Key files section")
    section = text.split("Key files", 1)[-1]
    for m in KEY_RE.finditer(section):
        raw = m.group(1)
        if raw.startswith("http") or raw.startswith("#"):
            continue
        if raw.startswith("PR ") or raw.startswith("wiki/"):
            continue
        candidate = ROOT / raw.lstrip("/")
        if raw.startswith("game/") or raw.startswith("pipeline/") or raw.startswith("docs/") or raw in {"Makefile", "AGENTS.md", "README.md", "CHECKPOINT_A.md"}:
            if not candidate.exists():
                fail(f"{path.relative_to(ROOT)}: Key files path does not exist: {raw}")


def main() -> None:
    files = pages()
    if not INDEX.is_file():
        fail("wiki/index.md is missing")
    index_text = INDEX.read_text()
    listed = index_listed(index_text)
    stems = stem_map(files)
    errors = 0

    def err(msg: str) -> None:
        nonlocal errors
        print(f"wiki_lint: {msg}", file=sys.stderr)
        errors += 1

    for path in files:
        rel = str(path.relative_to(WIKI)).replace("\\", "/")
        text = path.read_text()
        try:
            parse_frontmatter(text, path)
        except SystemExit:
            errors += 1
            continue
        if path.name not in {"index.md", "log.md"}:
            if rel not in listed and path.stem not in listed and rel.replace(".md", "") not in listed:
                err(f"{rel}: not listed in wiki/index.md")
        try:
            check_key_files(text, path)
        except SystemExit:
            errors += 1
        for m in LINK_RE.finditer(text):
            target = m.group(1) or m.group(2)
            if not target:
                continue
            if target.startswith("http"):
                continue
            if not resolve_link(target, stems, path):
                err(f"{rel}: broken link {target}")

    log = WIKI / "log.md"
    if log.is_file():
        lines = [ln for ln in log.read_text().splitlines() if ln.startswith("## [")]
        if not lines:
            err("wiki/log.md has no ## [YYYY-MM-DD] entries")

    if errors:
        fail(f"{errors} problem(s)")
    print(f"wiki_lint: ok ({len(files)} pages)")


if __name__ == "__main__":
    os.chdir(ROOT)
    main()
