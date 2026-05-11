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

    const results: Array<{ email: string; status: string; error?: string }> = [];

    for (const u of USERS) {
      const { data: existing } = await supabaseAdmin
        .from("profiles")
        .select("id")
        .eq("email", u.email)
        .maybeSingle();

      let userId = existing?.id as string | undefined;

      if (!userId) {
        const { data: created, error: createErr } = await supabaseAdmin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { full_name: u.full_name },
        });
        if (createErr || !created.user) {
          results.push({ email: u.email, status: "error", error: createErr?.message ?? "unknown" });
          continue;
        }
        userId = created.user.id;
      }

      // Upsert role to shipping_company
      await supabaseAdmin.from("user_roles").delete().eq("user_id", userId);
      const { error: roleErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: userId, role: "shipping_company" });

      if (roleErr) {
        results.push({ email: u.email, status: "role_error", error: roleErr.message });
        continue;
      }

      results.push({ email: u.email, status: existing ? "updated" : "created" });
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
