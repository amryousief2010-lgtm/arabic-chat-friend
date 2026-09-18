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
