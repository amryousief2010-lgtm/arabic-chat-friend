import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface UserToCreate {
  full_name: string;
  email: string;
  password: string;
}

const USERS: UserToCreate[] = [
  { full_name: "حبيبة", email: "habiba.shipping@naam-elasema.com", password: "Shipping@2026" },
  { full_name: "فاطمة", email: "fatma.shipping@naam-elasema.com", password: "Shipping@2026" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const results: Array<{ email: string; status: string; user_id?: string; error?: string }> = [];

    for (const u of USERS) {
      // Check if already exists
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("