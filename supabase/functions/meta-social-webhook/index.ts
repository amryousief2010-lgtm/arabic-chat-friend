// Edge Function: meta-social-webhook — استقبال رسائل ماسنجر وإنستجرام مباشرة من Meta.
// verify_jwt = false (ميتا لا ترسل JWT)؛ الحماية بتوقيع X-Hub-Signature-256 (META_APP_SECRET).
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleSocialWebhook, type SocialOp } from "./handler.ts";

const FN: Record<SocialOp["kind"], string> = {
  message: "cm_ingest_social_message", referral: "cm_social_referral", read: "cm_social_mark_read", log: "cm_log_social_webhook",
};

Deno.serve((req) => {
  const env = {
    META_APP_SECRET: Deno.env.get("META_APP_SECRET") ?? undefined,
    SOCIAL_WEBHOOK_VERIFY_TOKEN: Deno.env.get("SOCIAL_WEBHOOK_VERIFY_TOKEN") ?? undefined,
    WHATSAPP_VERIFY_TOKEN: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? undefined,
  };
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return handleSocialWebhook(req, env, async (op) => {
    const { data, error } = await db.rpc(FN[op.kind], op.args as Record<string, unknown>);
    if (error) throw new Error(error.message);
    return data;
  });
});
