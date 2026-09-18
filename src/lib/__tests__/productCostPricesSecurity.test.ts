import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Documents why lint 0010_security_definer_view is cleared without
 * weakening cost secrecy:
 *
 * PR #9 used security_invoker=false so the view owner could read
 * products.cost_price after that column was revoked from authenticated.
 * Lovable/Supabase flag that as a Security Definer View.
 *
 * Flipping only security_invoker=on would 42501 on p.cost_price.
 * Cost lives in product_cost_data (RLS: inv_can_view_cost). The view is
 * recreated WITH (security_invoker = on) and LEFT JOINs that table, so:
 *   - invoker RLS applies → clears 0010
 *   - GM/finance still see cost
 *   - marketers get catalog rows with cost_price NULL
 *   - products.cost_price stays ungranted to authenticated
 */
const migration = readFileSync(
  resolve(process.cwd(), "supabase/migrations/20260918225000_product_cost_data_security_invoker.sql"),
  "utf8",
);

const sql = migration
  .split("\n")
  .filter((line) => !/^\s*--/.test(line))
  .join("\n");

const viewSql =
  sql.match(/CREATE VIEW public\.product_cost_prices[\s\S]*?;/)?.[0] ?? "";

describe("product_cost_prices lint 0010 remediation", () => {
  it("recreates the view as security_invoker=on (not a definer view)", () => {
    expect(viewSql).toMatch(/CREATE VIEW public\.product_cost_prices\s+WITH \(security_invoker = on\)/);
    expect(viewSql).not.toMatch(/security_invoker\s*=\s*false/);
    expect(sql).toMatch(/DROP VIEW IF EXISTS public\.product_cost_prices/);
  });

  it("does not select products.cost_price and does not re-grant that column", () => {
    expect(sql).toMatch(/REVOKE SELECT \(cost_price\) ON public\.products FROM PUBLIC, anon, authenticated/);
    expect(sql).not.toMatch(/GRANT SELECT \(cost_price\)/);
    expect(viewSql).not.toMatch(/p\.cost_price/);
    expect(viewSql).toMatch(/cd\.cost_price/);
    expect(viewSql).toMatch(/LEFT JOIN public\.product_cost_data cd ON cd\.product_id = p\.id/);
  });

  it("gates product_cost_data reads (and writes) with inv_can_view_cost RLS", () => {
    expect(migration).toMatch(/CREATE TABLE IF NOT EXISTS public\.product_cost_data/);
    expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(migration).toMatch(/USING \(public\.inv_can_view_cost\(\)\)/);
    expect(migration).toMatch(/WITH CHECK \(public\.inv_can_view_cost\(\)\)/);
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.product_cost_data TO authenticated/);
    expect(migration).toMatch(/REVOKE ALL ON TABLE public\.product_cost_data FROM PUBLIC, anon/);
  });

  it("keeps frontend product_cost_prices contract and syncs products.cost_price writes", () => {
    expect(migration).toMatch(/p\.low_stock_threshold/);
    expect(migration).toMatch(/p\.is_active/);
    expect(migration).toMatch(/CREATE OR REPLACE FUNCTION public\.sync_product_cost_data\(\)/);
    expect(migration).toMatch(/AFTER INSERT OR UPDATE OF cost_price ON public\.products/);
  });
});
