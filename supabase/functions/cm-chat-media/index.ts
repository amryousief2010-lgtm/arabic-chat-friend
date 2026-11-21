// Edge Function: cm-chat-media — تشغيل طابور تنزيل الوسائط يدوياً/backfill.
// المصادقة: service role (مفتاح service_role يتحقق منه PostgREST) أو مستخدم cm_can_manage.
import { createServiceClient, requireVerifiedUser, isAuthResponse } from "../_shared/require-user.ts";
import { processPendingMedia } from "../_shared/wa-media.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const admin = createServiceClient();
  const bearer = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  // service role: PostgREST يتحقق من التوقيع؛ cm_media_pending ممنوحة لـ service_role فقط.
  let isService = bearer !== "" && bearer === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!isService && bearer.split(".").length === 3) {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/rest/v1/rpc/cm_media_pending`, { method: "POST",
      headers: { apikey: bearer, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify({ _limit: 1 }) });
    isService = r.ok;
  }
  if (!isService) {
    const auth = await requireVerifiedUser(req, cors, admin);
    if (isAuthResponse(auth)) return auth;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const userDb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: `Bearer ${auth.token}` } }, auth: { persistSession: false } });
    const { data: ok } = await userDb.rpc("cm_can_manage");
    if (!ok) return json({ error: "forbidden" }, 403);
  }
  const body = await req.json().catch(() => ({})) as { limit?: number };
  const r = await processPendingMedia(admin, Deno.env.get("WHATSAPP_ACCESS_TOKEN") ?? undefined, Math.min(body.limit ?? 20, 50));
  return json(r);
});
