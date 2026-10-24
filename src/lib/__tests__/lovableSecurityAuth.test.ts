import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

  it("config.toml verifies JWT for probe and deliveries; shipments uses in-function auth", () => {
    const toml = config();
    for (const name of ["zodex-probe", "sync-zodex-deliveries"]) {
      const block = toml.split(`[functions.${name}]`)[1] ?? "";
      expect(block.split("[")[0]).toMatch(/verify_jwt\s*=\s*true/);
    }
    const ship = (toml.split("[functions.sync-zodex-shipments]")[1] ?? "").split("[")[0];
    expect(ship).toMatch(/verify_jwt\s*=\s*false/);
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

  it("sync-zodex-deliveries requires a verified user JWT or service-role bearer before scraping", () => {
    const src = fn("sync-zodex-deliveries");
    expect(src).toMatch(/requireVerifiedUser/);
    expect(src).toMatch(/ZODEX_SYNC_ALLOWED_ROLES/);
    expect(src).toMatch(/isServiceRoleBearer/);
    expect(src).not.toMatch(/getClaims/);
    expect(src).not.toMatch(/allow as scheduled trigger/);
    const authIdx = src.indexOf("requireVerifiedUser");
    const loginIdx = src.indexOf("ZODEX_USERNAME");
    expect(authIdx).toBeGreaterThan(0);
    expect(loginIdx).toBeGreaterThan(authIdx);
  });

  it("sync-zodex-shipments accepts cron secret or verified ops user JWT before scraping", () => {
    const src = fn("sync-zodex-shipments");
    expect(src).toMatch(/requireVerifiedUser/);
    expect(src).toMatch(/ZODEX_SYNC_ALLOWED_ROLES/);
    expect(src).toMatch(/isZodexCronSecret/);
    expect(src).toMatch(/isServiceRoleBearer/);
    expect(src).not.toMatch(/getClaims/);
    expect(src).not.toMatch(/allow as scheduled trigger/);
    const cronIdx = src.indexOf("isZodexCronSecret");
    const authIdx = src.indexOf("requireVerifiedUser");
    const loginIdx = src.indexOf("ZODEX_USERNAME");
    expect(cronIdx).toBeGreaterThan(0);
    expect(authIdx).toBeGreaterThan(cronIdx);
    expect(loginIdx).toBeGreaterThan(authIdx);
  });

  it("shared helper verifies JWTs via Auth getUser and supports cron-secret + service-role schedule paths", () => {
    const src = helper();
    expect(src).toMatch(/admin\.auth\.getUser\(token\)/);
    expect(src).toMatch(/isServiceRoleBearer/);
    expect(src).toMatch(/isZodexCronSecret/);
    expect(src).toMatch(/ZODEX_CRON_SECRET/);
    expect(src).toMatch(/matchesCronSecret/);
    expect(src).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(src).toMatch(/warehouse_supervisor/);
    expect(src).toMatch(/agouza_warehouse_keeper/);
    expect(src).not.toMatch(/atob\s*\(/);
    expect(src).not.toMatch(/console\.(log|info|debug|warn|error)\(.*ZODEX_CRON/);
  });

  it("sync-zodex-shipments keeps scheduled AWB copy on resolveScheduledMode + overlap guard", () => {
    const src = fn("sync-zodex-shipments");
    expect(src).toMatch(/resolveScheduledMode/);
    expect(src).toMatch(/already_running/);
    expect(src).toMatch(/isExpectedZodexShipment/);
    expect(src).toMatch(/phone2/);
  });

  it("auto AWB cron authenticates with vault zodex_cron_secret, not a service_role Bearer", () => {
    const sql = readFileSync(
      resolve(process.cwd(), "supabase/migrations/20260921120000_zodex_cron_secret_auth.sql"),
      "utf8",
    );
    expect(sql).toMatch(/invoke_scheduled_zodex_sync/);
    expect(sql).toMatch(/zodex_cron_secret/);
    expect(sql).toMatch(/x-zodex-cron-secret/);
    expect(sql).toMatch(/vault\.create_secret/);
    expect(sql).toMatch(/sync-zodex-shipments/);
    expect(sql).toMatch(/cron\.schedule/);
    expect(sql).toMatch(/\*\/5 \* \* \* \*/);
    expect(sql).toMatch(/sync-zodex-awb-weekly-full/);
    expect(sql).toMatch(/CREATE SCHEMA IF NOT EXISTS private/);
    expect(sql).toMatch(/ZODEX_CRON_SECRET/);
    expect(sql).not.toMatch(/Authorization.*Bearer/);
    expect(sql).not.toMatch(/zodex_sync_service_role_key/);
    expect(sql).not.toMatch(/email_queue_service_role_key/);
    expect(sql).not.toMatch(/SUPABASE_ANON/);
    expect(sql).not.toMatch(/RAISE NOTICE.*v_secret/);
    expect(sql).not.toMatch(/RAISE WARNING.*v_secret/);
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

/** MCP is Lovable-generated; JWT is oauth.issuer + verify_jwt, not requireVerifiedUser. */
const REMAINING_HAND_AUTHORED_FUNCTIONS = REMAINING_FUNCTIONS.filter(
  (name) => name !== "mcp",
);

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

  it("config.toml disables gateway JWT only for auth-email-hook and sync-zodex-shipments", () => {
    const toml = config();
    const disabled = [...toml.matchAll(/\[functions\.([^\]]+)\]\s*\nverify_jwt\s*=\s*false/g)]
      .map((m) => m[1])
      .sort();
    expect(disabled).toEqual(["auth-email-hook", "sync-zodex-shipments"]);
  });

  it.each(REMAINING_HAND_AUTHORED_FUNCTIONS)(
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

  it("MCP function is Lovable-generated and keeps oauth issuer auth in source", () => {
    const mcp = fn("mcp");
    const mcpSrc = readFileSync(resolve(process.cwd(), "src/lib/mcp/index.ts"), "utf8");
    expect(mcp).toMatch(/AUTO-GENERATED by @lovable\.dev\/mcp-js/);
    expect(mcp).not.toMatch(/requireVerifiedUser/);
    expect(mcpSrc).toMatch(/auth\.oauth\.issuer/);
    expect(mcpSrc).toMatch(/acceptedAudiences:\s*"authenticated"/);
  });

  it("vite keeps stock mcpPlugin so Lovable codegen can overwrite the bannered bundle", () => {
    const vite = readFileSync(resolve(process.cwd(), "vite.config.ts"), "utf8");
    expect(vite).toMatch(/mcpPlugin\(\)/);
    expect(vite).not.toMatch(/vite\.mcp-auth-wrap/);
    expect(vite).not.toMatch(/requireVerifiedUser/);
  });

  it("profiles self-update policy has WITH CHECK; identity freeze stays on the trigger", () => {
    const migrationsDir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    const allSql = files
      .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
      .join("\n");
    expect(allSql).toMatch(/trg_profiles_guard_identity_fields/);
    expect(allSql).toMatch(/identity_field_change_forbidden: full_name/);
    expect(allSql).toMatch(/identity_field_change_forbidden: email/);
    expect(allSql).toMatch(/identity_field_change_forbidden: shipping_company_name/);

    let lastPolicy = "";
    const re = /CREATE POLICY "Users can update their own profile"[\s\S]*?;/g;
    for (const f of files) {
      const sql = readFileSync(join(migrationsDir, f), "utf8");
      let m: RegExpExecArray | null;
      while ((m = re.exec(sql))) lastPolicy = m[0];
      re.lastIndex = 0;
    }
    expect(lastPolicy).toMatch(/WITH CHECK\s*\(\s*\(SELECT auth\.uid\(\)\)\s*=\s*id\s*\)/);
    expect(lastPolicy).not.toMatch(/full_name/);
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
