// Edge Function: whatsapp-webhook — استقبال رسائل واتساب من Meta.
// غير منشورة. خاملة حتى تُضبط الأسرار (META_APP_SECRET، WHATSAPP_VERIFY_TOKEN): ترد 503 ولا تكتب شيئاً.
// تحتاج verify_jwt = false (ميتا لا ترسل JWT)؛ الحماية بتوقيع X-Hub-Signature-256.
import { createClient } from "npm:@supabase/supabase-js@2";
import { handleWebhook, type IngestArgs, type IngestResult } from "./handler.ts";

Deno.serve((req) => {
  const env = {
    META_APP_SECRET: Deno.env.get("META_APP_SECRET") ?? undefined,
    WHATSAPP_VERIFY_TOKEN: Deno.env.get("WHATSAPP_VERIFY_TOKEN") ?? undefined,
  };
  const ingest = async (args: IngestArgs): Promise<IngestResult> => {
    const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data, error } = await db.rpc("cm_ingest_whatsapp_message", args);
    if (error) throw new Error(error.message);
    return data as IngestResult;
  };
  return handleWebhook(req, env, ingest);
});
