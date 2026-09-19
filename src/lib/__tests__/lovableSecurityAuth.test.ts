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

describe("Lovable Zodex follow-up auth hardening", () => {
  const helper = () =>
    readFileSync(resolve(process.cwd(), "supabase/functions/_shared/require-user.ts"), "utf8");
  const config = () =>
    readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");

  it("config.toml verifies JWT for probe and both Zodex sync functions", () => {
    const toml = config();
    for (const name of ["zodex-probe", "sync-zodex-deliveries", "sync-zodex-shipments"]) {
      const block = toml.split(`[functions.${name}]`)[1] ?? "";
      expect(block.split("[")[0]).toMatch(/verify_jwt\s*=\s*true/);
    }
  });

  it("zodex-probe verifies JWT and review roles before using courier credentials", () => {
    const src = fn("zodex-probe");
    const authIdx = src.indexOf("requireVerifiedUser");
    const credIdx = src.indexOf("ZODEX_USERNAME");
    expect(authIdx).toBeGreaterThan(0);
    expect(credIdx).toBeGreaterThan(authIdx);
    expect(src).toMatch(/ZODEX_REVIEW_ALLOWED_ROLES/);
    expect(src).toMatch(/userHasAnyRole/);
    expect(src).toMatch(/ZODEX_PROBE_ENABLED/);
  });

  it.each(["sync-zodex-deliveries", "sync-zodex-shipments"])(
    "%s requires a verified user JWT or service-role bearer before scraping",
    (name) => {
      const src = fn(name);
      expect(src).toMatch(/requireVerifiedUser/);
      expect(src).toMatch(/ZODEX_SYNC_ALLOWED_ROLES/);
      expect(src).toMatch(/isServiceRoleBearer/);
      expect(src).not.toMatch(/getClaims/);
      expect(src).not.toMatch(/allow as scheduled trigger/);
      const authIdx = src.indexOf("requireVerifiedUser");
      const loginIdx = src.indexOf("ZODEX_USERNAME");
      expect(authIdx).toBeGreaterThan(0);
      expect(loginIdx).toBeGreaterThan(authIdx);
    },
  );

  it("shared helper verifies JWTs via Auth getUser and treats only the service-role key as cron", () => {
    const src = helper();
    expect(src).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(src).toMatch(/isServiceRoleBearer/);
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/warehouse_supervisor/);
    expect(src).toMatch(/agouza_warehouse_keeper/);
    expect(src).not.toMatch(/atob\s*\(/);
  });
});

const REMAINING_FUNCTIONS = [
  "ai-assistant-chat",
  "audit-offer-box-pricing",
  "create-employee",
  "delete-user",
  "hatchery-import-commit",
  "import-sales",
  "mcp",
  "phase2-import-executor",
  "process-email-queue",
  "rebuild-may-orders",
  "reset-password",
  "suggest-product-price",
  "update-user-email",
] as const;

describe("Lovable remaining edge-function auth hardening", () => {
  const config = () =>
    readFileSync(resolve(process.cwd(), "supabase/config.toml"), "utf8");

  it("config.toml verifies JWT for every remaining function", () => {
    const toml = config();
    for (const name of REMAINING_FUNCTIONS) {
      const block = toml.split(`[functions.${name}]`)[1] ?? "";
      expect(block.split("[")[0]).toMatch(/verify_jwt\s*=\s*true/);
    }
  });

  it.each(REMAINING_FUNCTIONS)(
    "%s calls requireVerifiedUser and does not decode JWTs locally",
    (name) => {
      const src = fn(name);
      expect(src).toMatch(/requireVerifiedUser/);
      expect(src).toMatch(/isAuthResponse/);
      expect(src).not.toMatch(/atob\s*\(/);
      expect(src).not.toMatch(/getUserIdFromJwt/);
      expect(src).not.toMatch(/getClaims/);
      expect(src).not.toMatch(/parseJwtClaims/);
    },
  );

  it("auth-email-hook is unchanged and still does not use requireVerifiedUser", () => {
    const src = fn("auth-email-hook");
    expect(src).not.toMatch(/requireVerifiedUser/);
  });

  it("process-email-queue allows only the service-role bearer after verifying other JWTs", () => {
    const src = fn("process-email-queue");
    expect(src).toMatch(/isServiceRoleBearer/);
    expect(src).toMatch(/requireVerifiedUser/);
    expect(src).not.toMatch(/atob\s*\(/);
  });

  it.each([
    ["delete-user", "DELETE_USER_ALLOWED_ROLES", "general_manager"],
    ["create-employee", "CREATE_EMPLOYEE_ALLOWED_ROLES", "sales_manager"],
    ["reset-password", "RESET_PASSWORD_ALLOWED_ROLES", "general_manager"],
    ["update-user-email", "UPDATE_EMAIL_ALLOWED_ROLES", "executive_manager"],
    ["rebuild-may-orders", "REBUILD_MAY_ALLOWED_ROLES", "general_manager"],
    ["phase2-import-executor", "ADMIN_ROLES", "executive_manager"],
    ["import-sales", "IMPORT_SALES_ALLOWED_ROLES", "general_manager"],
    ["hatchery-import-commit", "HATCHERY_IMPORT_ALLOWED_ROLES", "hatchery_manager"],
    ["ai-assistant-chat", "ALLOWED_ROLES", "executive_manager"],
    ["audit-offer-box-pricing", "AUDIT_ALLOWED_ROLES", "sales_manager"],
    ["suggest-product-price", "SUGGEST_PRICE_ALLOWED_ROLES", "financial_manager"],
  ] as const)("%s keeps a role gate (%s includes %s)", (name, constant, role) => {
    const src = fn(name);
    expect(src).toMatch(/userHasAnyRole/);
    expect(src).toMatch(new RegExp(constant));
    expect(src).toMatch(new RegExp(role));
  });
});
