import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const fn = (name: string) =>
  readFileSync(resolve(process.cwd(), "supabase/functions", name, "index.ts"), "utf8");

describe("Lovable critical auth hardening", () => {
  it("process-bostta-delivery verifies JWT via Auth getUser instead of decoding the payload", () => {
    const src = fn("process-bostta-delivery");
    const helper = readFileSync(
      resolve(process.cwd(), "supabase/functions/_shared/require-user.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/atob\s*\(/);
    expect(src).not.toMatch(/getUserIdFromJwt/);
    expect(src).toMatch(/requireVerifiedUser/);
    expect(helper).toMatch(/admin\.auth\.getUser\(token\)/);
  });

  it("department-monthly-budget requires a verified JWT and financial roles", () => {
    const src = fn("department-monthly-budget");
    expect(src).toMatch(/requireVerifiedUser/);
    expect(src).toMatch(/BUDGET_ALLOWED_ROLES/);
    expect(src).toMatch(/financial_manager/);
  });

  it("zodex-bill-details requires auth before using courier credentials", () => {
    const src = fn("zodex-bill-details");
    const authIdx = src.indexOf("requireVerifiedUser");
    const credIdx = src.indexOf("ZODEX_USERNAME");
    expect(authIdx).toBeGreaterThan(0);
    expect(credIdx).toBeGreaterThan(authIdx);
  });
});
