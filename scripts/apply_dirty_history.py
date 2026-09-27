#!/usr/bin/env python3
"""Apply migrations 7-20 on a database that already has 1-6, after dirty history.

Migrations through 20260927143000 use the same replica wrap as apply_migrations.py.
The seed then runs with triggers off. Migrations from 20260927150000 run as live
does: no session_replication_role, so unique indexes and checks are real.
"""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_migrations as am

ROOT = Path(__file__).resolve().parents[1]
CUTOFF = "20260927150000"


def main() -> None:
    files = sorted(am.MIGRATIONS.glob("*.sql"))
    before = [p for p in files if p.name < CUTOFF]
    after = [p for p in files if p.name >= CUTOFF]
    if not after or not after[0].name.startswith(CUTOFF):
        print(f"missing migration {CUTOFF}", file=sys.stderr)
        sys.exit(1)

    am.run_sql(am.PRELUDE.read_text(), "prelude")
    seed = """
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'warehouses'
  ) THEN
    INSERT INTO public.warehouses (id, name)
    VALUES
      ('5ec781b5-685b-4806-b59a-83a79ea5662c', 'المخزن الرئيسي'),
      ('a970d469-37df-40e1-b99f-a49195a3778e', 'مخزن العجوزة')
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;
"""
    print(f"applying {len(before)} migrations through 6", flush=True)
    for i, path in enumerate(before, 1):
        sql = "SET session_replication_role = replica;\n" + seed + am.wrap_txn(am.preprocess(path.read_text()))
        am.run_sql(sql, f"{i}/{len(before)} {path.name}")
        if i % 80 == 0 or i == len(before):
            print(f"ok {i}/{len(before)} {path.name}", flush=True)

    print("seeding dirty history", flush=True)
    am.run_sql((ROOT / "scripts/dirty_history_seed.sql").read_text(), "dirty seed")

    print(f"applying {len(after)} migrations from 7 without replica", flush=True)
    for i, path in enumerate(after, 1):
        sql = am.wrap_txn(am.preprocess(path.read_text()))
        am.run_sql(sql, f"7+ {i}/{len(after)} {path.name}")
        print(f"ok {path.name}", flush=True)

    print("asserting stock and two-line deduction", flush=True)
    am.run_sql((ROOT / "scripts/dirty_history_assert.sql").read_text(), "dirty assert")
    print("DIRTY_HISTORY_APPLY_OK", flush=True)


if __name__ == "__main__":
    os.environ.setdefault("PGDATABASE", "ledger_dirty")
    main()
