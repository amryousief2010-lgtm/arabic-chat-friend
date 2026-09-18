import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2";

export function jsonAuthError(
  corsHeaders: Record<string, string>,
  status: 401 | 403,
  message: string,
) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Verify the caller JWT via Supabase Auth (signature + user). Never decode payload locally. */
export async function requireVerifiedUser(
  req: Request,
  corsHeaders: Record<string, string>,
  admin: {
    auth: { getUser: (jwt: string) => Promise<{ data: { user: User | null }; error: unknown }> };
  },
): Promise<{ user: User; token: string } | Response> {
  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.toLowerCase().startsWith("bearer ")) {
    return jsonAuthError(corsHeaders, 401, "Unauthorized");
  }
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return jsonAuthError(corsHeaders, 401, "Unauthorized");
  }
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) {
    return jsonAuthError(corsHeaders, 401, "Unauthorized");
  }
  return { user: data.user, token };
}

export async function userHasAnyRole(
  admin: { from: (table: string) => any },
  userId: string,
  allowed: readonly string[],
): Promise<boolean> {
  const { data } = await admin.from("user_roles").select("role").eq("user_id", userId);
  const allowedSet = new Set(allowed);
  return (data || []).some((r: { role: string }) => allowedSet.has(r.role));
}

export function isAuthResponse(
  result: { user: User; token: string } | Response,
): result is Response {
  return result instanceof Response;
}

/**
 * Same family as `ZODEX_REVIEW_ALLOWED_ROLES` / zodex-bill-details.
 * Used for courier-portal reads (probe, bill details).
 */
export const ZODEX_REVIEW_ALLOWED_ROLES = [
  "general_manager",
  "executive_manager",
  "warehouse_supervisor",
  "agouza_warehouse_keeper",
  "sales_manager",
  "marketing_sales_manager",
  "marketing_sales_viewer",
  "financial_manager",
  "accountant",
] as const;

/**
 * Ops/warehouse roles that may trigger Zodex scrapes + DB writes.
 * Includes every role that can click in-app sync today (review, marketing
 * dashboard, Agouza warehouse hub) so authorized UI callers keep working.
 */
export const ZODEX_SYNC_ALLOWED_ROLES = [
  ...ZODEX_REVIEW_ALLOWED_ROLES,
  "sales_moderator",
  "production_manager",
  "quality_manager",
  "meat_factory_manager",
  "feed_factory_manager",
  "slaughterhouse_manager",
] as const;

/**
 * Scheduled-job path: only the project service-role JWT.
 * The public anon/publishable key must never be treated as a cron trigger.
 */
export function isServiceRoleBearer(req: Request): boolean {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!serviceKey) return false;
  const auth = req.headers.get("Authorization") || "";
  return auth === `Bearer ${serviceKey}`;
}
