import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Simulates the orders INSERT WITH CHECK clause:
 *   auth.uid() = created_by
 *   AND has_any_role(auth.uid(), ARRAY[<sales roles>])
 */
const SALES_ROLES = [
  "general_manager",
  "executive_manager",
  "sales_manager",
  "sales_moderator",
  "marketing_sales_manager",
] as const;

type Role = typeof SALES_ROLES[number] | "accountant" | "warehouse_supervisor" | "shipping_company" | null;

function canInsertOrder(authUid: string | null, createdBy: string | null, role: Role): boolean {
  if (!authUid) return false;
  if (authUid !== createdBy) return false;
  if (!role) return false;
  return (SALES_ROLES as readonly string[]).includes(role);
}

describe("orders INSERT RLS — WITH CHECK simulation", () => {
  const uid = "user-1";

  it.each(SALES_ROLES)("allows %s to insert their own order", (role) => {
    expect(canInsertOrder(uid, uid, role)).toBe(true);
  });

  it("denies users with a null role (no user_roles row)", () => {
    expect(canInsertOrder(uid, uid, null)).toBe(false);
  });

  it.each(["accountant", "warehouse_supervisor", "shipping_company"] as const)(
    "denies non-sales role: %s",
    (role) => {
      expect(canInsertOrder(uid, uid, role)).toBe(false);
    }
  );

  it("denies inserting an order with a different created_by", () => {
    expect(canInsertOrder(uid, "someone-else", "sales_moderator")).toBe(false);
  });

  it("denies unauthenticated users", () => {
    expect(canInsertOrder(null, uid, "sales_manager")).toBe(false);
  });
});

describe("orders INSERT RLS — migration SQL contract", () => {
  const migrationsDir = join(process.cwd(), "supabase", "migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  // Find the most recent migration that defines the orders INSERT policy.
  const policySql = (() => {
    for (const f of [...files].reverse()) {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      if (/CREATE POLICY[\s\S]*ON\s+public\.orders[\s\S]*FOR\s+INSERT/i.test(sql)) {
        return sql;
      }
    }
    return "";
  })();

  it("defines a current INSERT policy on public.orders", () => {
    expect(policySql).not.toBe("");
  });

  it("requires auth.uid() = created_by", () => {
    expect(policySql).toMatch(/auth\.uid\(\)\s*=\s*created_by/i);
  });

  it("requires has_any_role with the sales roles array", () => {
    expect(policySql).toMatch(/has_any_role\s*\(/i);
    for (const role of SALES_ROLES) {
      expect(policySql).toContain(role);
    }
  });

  it("does NOT leave a permissive policy that lets any authenticated user insert", () => {
    // The old policy was just `auth.uid() = created_by` with no role gate.
    // Make sure no current INSERT policy on orders lacks has_any_role.
    const insertPolicies = policySql.match(
      /CREATE POLICY[\s\S]*?ON\s+public\.orders[\s\S]*?FOR\s+INSERT[\s\S]*?;/gi
    ) ?? [];
    for (const p of insertPolicies) {
      expect(p).toMatch(/has_any_role/i);
    }
  });
});
