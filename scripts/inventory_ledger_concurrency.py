#!/usr/bin/env python3
"""Two sessions posting the same card, then the same source key.

Uses the local cluster when DATABASE_URL is unset (sudo -u postgres).
Cleans up the rows it inserts.
"""
import os
import subprocess
import sys
import threading
import uuid

DB = os.environ.get("PGDATABASE", "p0_verify")
USE_URL = os.environ.get("DATABASE_URL")


def psql(sql: str) -> str:
    if USE_URL:
        cmd = ["psql", USE_URL, "-v", "ON_ERROR_STOP=1", "-At"]
    else:
        cmd = ["sudo", "-u", "postgres", "psql", "-d", DB, "-v", "ON_ERROR_STOP=1", "-At"]
    proc = subprocess.run(cmd, input=sql, text=True, capture_output=True)
    if proc.returncode != 0:
        raise SystemExit((proc.stderr or "") + (proc.stdout or ""))
    return (proc.stdout or "").strip()


def main() -> None:
    wh = str(uuid.uuid4())
    gm = str(uuid.uuid4())
    item = str(uuid.uuid4())
    prod = str(uuid.uuid4())
    src = str(uuid.uuid4())
    psql(f"""
INSERT INTO auth.users (id, email, aud, role)
VALUES ('{gm}', 'conc-{gm[:8]}@test.local', 'authenticated', 'authenticated');
INSERT INTO public.user_roles (user_id, role) VALUES ('{gm}', 'general_manager');
INSERT INTO public.warehouses (id, name) VALUES ('{wh}', 'مخزن تزامن {wh[:8]}');
INSERT INTO public.products (id, name, price, barcode)
VALUES ('{prod}', 'صنف تزامن {prod[:8]}', 1, 'CN{prod[:8]}');
INSERT INTO public.inventory_items (id, warehouse_id, product_id, name, unit, stock)
VALUES ('{item}', '{wh}', '{prod}', 'تزامن', 'كجم', 0);
SELECT set_config('request.jwt.claim.sub', '{gm}', false);
SELECT public.post_manual_inventory_movement(
  '{item}'::uuid, 'in', 100, 'افتتاح اختبار التزامن',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL
);
""")

    barrier = threading.Barrier(2)
    errors = []

    def worker(qty_sql: str) -> None:
        try:
            barrier.wait(timeout=30)
            psql(f"""
SELECT set_config('request.jwt.claim.sub', '{gm}', false);
SELECT set_config('request.jwt.claim.role', 'authenticated', false);
{qty_sql}
""")
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    t1 = threading.Thread(target=worker, args=(
        f"SELECT public.post_manual_inventory_movement('{item}'::uuid, 'out', 30, 'خصم تزامن أ', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);",
    ))
    t2 = threading.Thread(target=worker, args=(
        f"SELECT public.post_manual_inventory_movement('{item}'::uuid, 'out', 30, 'خصم تزامن ب', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL);",
    ))
    t1.start(); t2.start(); t1.join(); t2.join()
    if errors:
        raise SystemExit("concurrency errors:\n" + "\n".join(errors))
    stock = psql(f"SELECT stock FROM public.inventory_items WHERE id = '{item}'")
    if stock != "40.00" and stock != "40":
        raise SystemExit(f"expected stock 40 after two outs, got {stock}")
    print("two sessions relative outs ->", stock)

    barrier2 = threading.Barrier(2)
    errors.clear()

    def same_key() -> None:
        try:
            barrier2.wait(timeout=30)
            psql(f"""
SELECT set_config('request.jwt.claim.sub', '{gm}', false);
SELECT public.post_inventory_movement(
  '{item}'::uuid, 'in', 10, 'manual_in', '{src}'::uuid, '1',
  'مفتاح واحد', NULL, now(), NULL, NULL, NULL, 'delta', false,
  '{wh}'::uuid, '{prod}'::uuid, 'test', NULL, NULL, 'manual_in', NULL, NULL, NULL, NULL, NULL
);
""")
        except Exception as exc:  # noqa: BLE001
            errors.append(str(exc))

    a = threading.Thread(target=same_key)
    b = threading.Thread(target=same_key)
    a.start(); b.start(); a.join(); b.join()
    if errors:
        raise SystemExit("same-key errors:\n" + "\n".join(errors))
    stock2 = psql(f"SELECT stock FROM public.inventory_items WHERE id = '{item}'")
    # 40 + 10 once = 50
    if stock2 not in ("50.00", "50"):
        raise SystemExit(f"expected stock 50 after one idempotent in, got {stock2}")
    n = psql(f"""
SELECT count(*) FROM public.inventory_movements
 WHERE source_type = 'manual_in' AND source_id = '{src}' AND source_line_id = '1'
""")
    if n != "1":
        raise SystemExit(f"expected 1 source row, got {n}")
    print("same source key twice ->", stock2, "rows", n)

    psql(f"""
BEGIN;
SELECT set_config('app.inventory_ledger_purge', 'on', true);
DELETE FROM public.inventory_movements
 WHERE item_id IN (SELECT id FROM public.inventory_items WHERE product_id = '{prod}' OR id = '{item}');
DELETE FROM public.inventory_items WHERE product_id = '{prod}' OR id = '{item}';
DELETE FROM public.products WHERE id = '{prod}';
DELETE FROM public.warehouses WHERE id = '{wh}';
DELETE FROM public.user_roles WHERE user_id = '{gm}';
DELETE FROM auth.users WHERE id = '{gm}';
COMMIT;
""")
    print("CONCURRENCY_OK")


if __name__ == "__main__":
    main()
