#!/usr/bin/env python3
"""Apply supabase/migrations onto a disposable Postgres.

DATABASE_URL selects the target (CI). Without it, the local cluster database
named by PGDATABASE (default p0_verify) is used via sudo -u postgres.

Does not drop the database. Run it on an empty database. Historical files that
COMMIT themselves (enum ADD VALUE) are not wrapped in another transaction.
"""
import os
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS = ROOT / "supabase" / "migrations"
PRELUDE = ROOT / "scripts" / "pg_test_prelude.sql"

EXT_RE = re.compile(
    r"CREATE\s+EXTENSION(?:\s+IF\s+NOT\s+EXISTS)?\s+(?:pg_cron|pg_net|supabase_vault|pgmq)\b[^;]*;",
    re.IGNORECASE,
)
CRON_DO = re.compile(
    r"DO\s+\$\$\s+BEGIN\s+IF NOT EXISTS \(\s*SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'\s*\) THEN\s*"
    r"CREATE EXTENSION pg_cron;\s*END IF;\s*END\s+\$\$\s*;",
    re.IGNORECASE | re.DOTALL,
)
HAS_COMMIT = re.compile(r"(?im)^\s*commit\s*;\s*$")


def psql_cmd() -> list[str]:
    url = os.environ.get("DATABASE_URL")
    if url:
        return ["psql", url, "-v", "ON_ERROR_STOP=1"]
    db = os.environ.get("PGDATABASE", "p0_verify")
    return ["sudo", "-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1"]


def preprocess(sql: str) -> str:
    sql = CRON_DO.sub("SELECT 1;", sql)
    return EXT_RE.sub("SELECT 1;", sql)


def wrap_txn(sql: str) -> str:
    if HAS_COMMIT.search(sql):
        return sql
    return "BEGIN;\n" + sql + "\nCOMMIT;\n"


def run_sql(sql: str, label: str) -> None:
    proc = subprocess.run(psql_cmd(), input=sql, text=True, capture_output=True)
    if proc.returncode != 0:
        err = (proc.stderr or "") + "\n" + (proc.stdout or "")
        print(f"\nFAIL {label}\n{err[-5000:]}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    run_sql(PRELUDE.read_text(), "prelude")
    files = sorted(MIGRATIONS.glob("*.sql"))
    print(f"applying {len(files)} migrations", flush=True)
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
    for i, path in enumerate(files, 1):
        sql = "SET session_replication_role = replica;\n" + seed + wrap_txn(preprocess(path.read_text()))
        proc = subprocess.run(psql_cmd(), input=sql, text=True, capture_output=True)
        if proc.returncode != 0:
            err = (proc.stderr or "") + "\n" + (proc.stdout or "")
            print(f"\nFAIL {i}/{len(files)} {path.name}\n{err[-5000:]}", file=sys.stderr)
            sys.exit(2)
        if i % 50 == 0 or i == len(files):
            print(f"ok {i}/{len(files)} {path.name}", flush=True)
    print("ALL MIGRATIONS APPLIED", flush=True)


if __name__ == "__main__":
    main()
