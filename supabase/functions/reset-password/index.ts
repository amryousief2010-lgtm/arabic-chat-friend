import { createClient } from "https://esm.sh/@supabase/supabase-js@2.89.0";
import {
  isAuthResponse,
  requireVerifiedUser,
  userHasAnyRole,
} from "../_shared/require-user.ts";

const RESET_PASSWORD_ALLOWED_ROLES = ["general_manager"] as const;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    const verified = await requireVerifiedUser(req, corsHeaders, supabaseAdmin);
    if (isAuthResponse(verified)) return verified;

    const allowed = await userHasAnyRole(supabaseAdmin, verified.user.id, RESET_PASSWORD_ALLOWED_ROLES);
    if (!allowed) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { userId, newPassword } = await req.json();
    if (!userId || typeof newPassword !== "string" || newPassword.length < 8) {
      return new Response(JSON.stringify({ error: "Invalid input" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: newPassword,
    });
    if (error) {
      const code = (error as any).code || "";
      const status = (error as any).status || 400;
      if (code === "weak_password" || status === 422) {
        return new Response(
          JSON.stringify({ error: "كلمة السر ضعيفة أو مسربة، اختر كلمة أقوى وغير شائعة", code: "weak_password" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      return new Response(
        JSON.stringify({ error: error.message || "تعذر تحديث كلمة السر" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`Password reset by ${verified.user.id} for target ${userId}`);

    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("reset-password error", error);
    return new Response(JSON.stringify({ error: (error as any)?.message || "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
