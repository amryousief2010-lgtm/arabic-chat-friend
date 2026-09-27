#!/usr/bin/env python3
"""Fail if client or edge code writes the ledger tables directly."""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
MOVE = re.compile(
    r"""from\(\s*["']inventory_movements["']\s*\)\s*\.\s*(insert|update|delete)"""
)
STOCK = re.compile(
    r"""from\(\s*["']inventory_items["']\s*\)[\s\S]{0,400}?\.update\(\s*\{[^}]*\bstock\b""",
    re.MULTILINE,
)
bad = []
paths = list((ROOT / "src").rglob("*.ts")) + list((ROOT / "src").rglob("*.tsx"))
paths += list((ROOT / "supabase" / "functions").rglob("*.ts"))
for path in paths:
    if "mcp" in path.parts:
        continue
    text = path.read_text(errors="ignore")
    if MOVE.search(text) or STOCK.search(text):
        bad.append(str(path.relative_to(ROOT)))
if bad:
    print("Direct inventory ledger writes are not allowed:")
    print("\n".join(bad))
    sys.exit(1)
print("inventory client writes: ok")
