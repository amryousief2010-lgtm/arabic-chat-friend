/**
 * Edge Function: woo-order-ingest
 *
 * WooCommerce (capitalostrich.com) webhooks → public.website_inbox via website_inbox_upsert.
 * verify_jwt = false (WooCommerce sends no JWT). Auth = HMAC X-WC-Webhook-Signature
 * with env WOO_WEBHOOK_SECRET (constant-time). Logic in ./handler.ts.
 */
import { createServiceClient } from "../_shared/require-user.ts";
import { handleWooWebhook } from "./handler.ts";

Deno.serve((req) => {
  const env = { WOO_WEBHOOK_SECRET: Deno.env.get("WOO_WEBHOOK_SECRET") ?? undefined };
  return handleWooWebhook(req, env, async (op) => {
    const admin = createServiceClient();
    const { data, error } = await admin.rpc("website_inbox_upsert", {
      _kind: op.kind,
      _external_id: op.external_id,
      _data: op.data,
      _topic: op.topic,
      _delivery_id: op.delivery_id,
    });
    if (error) throw new Error(error.message);
    return data;
  });
});
