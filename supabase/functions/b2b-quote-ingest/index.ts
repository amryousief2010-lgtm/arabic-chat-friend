/**
 * Edge Function: b2b-quote-ingest
 *
 * capitalostrich.com «للفنادق والمطاعم» quote form (server-side, WordPress) →
 * public.b2b_quote_requests via b2b_quote_ingest (service_role only).
 * verify_jwt = false (the site sends no JWT). Auth = HMAC X-COC-Signature over
 * `${X-COC-Timestamp}.${rawBody}` with env B2B_QUOTE_SECRET. Logic in ./handler.ts.
 */
import { createServiceClient } from "../_shared/require-user.ts";
import { handleQuoteRequest, type IngestResult } from "./handler.ts";

Deno.serve((req) => {
  const env = { B2B_QUOTE_SECRET: Deno.env.get("B2B_QUOTE_SECRET") ?? undefined };
  return handleQuoteRequest(req, env, async (data) => {
    const admin = createServiceClient();
    const { data: out, error } = await admin.rpc("b2b_quote_ingest", { _data: data });
    if (error) throw new Error(error.message);
    return out as IngestResult;
  });
});
