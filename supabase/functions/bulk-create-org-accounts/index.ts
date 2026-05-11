import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Role =
  | "general_manager" | "executive_manager" | "sales_manager" | "sales_moderator"
  | "accountant" | "warehouse_supervisor" | "farm_manager" | "hatchery_manager"
  | "brooding_manager" | "slaughterhouse_manager" | "meat_factory_manager"
  | "feed_factory_manager" | "hr_manager" | "production_manager"
  | "marketing_sales_manager" | "financial_manager" | "quality_manager";

interface NewEmp {
  full_name: string;
  email: string;
  password: string;
  role: Role;
}

const employees: NewEmp[] = [
  // Production unit
  { full_name: "أحمد خاطر", email: "ahmed.khater@naam-capital.com", password: "Naam@2026!Khater", role: "farm_manager" },
  { full_name: "حجاج قرني", email: "haggag.qorny@naam-capital.com", password: "Naam@2026!Haggag", role: "farm_manager" },
  { full_name: "عبداللطيف", email: "abdellatif@naam-capital.com", password: "Naam@2026!Latif", role: "hatchery_manager" },
  { full_name: "محمود عزت", email: "mahmoud.ezzat@naam-capital.com", password: "Naam@2026!Ezzat", role: "hatchery_manager" },
  { full_name: "عابد زكريا", email: "abed.zakaria@naam-capital.com", password: "Naam@2026!Abed", role: "brooding_manager" },
  { full_name: "السيد المرسي", email: "elsayed.elmorsy@naam-capital.com", password: "Naam@2026!Morsy", role: "brooding_manager" },
  { full_name: "محمود جمال", email: "mahmoud.gamal@naam-capital.com", password: "Naam@2026!MGamal", role: "slaughterhouse_manager" },
  { full_name: "مصطفى محمد", email: "mostafa.mohamed@naam-capital.com", password: "Naam@2026!Mostafa", role: "slaughterhouse_manager" },
  { full_name: "يوسف زغلول", email: "youssef.zaghloul@naam-capital.com", password: "Naam@2026!Youssef", role: "slaughterhouse_manager" },
  { full_name: "إبراهيم السعدني", email: "ibrahim.elsadany@naam-capital.com", password: "Naam@2026!Ibrahim", role: "slaughterhouse_manager" },
  { full_name: "رضا عطية", email: "reda.atia@naam-capital.com", password: "Naam@2026!Reda", role: "slaughterhouse_manager" },
  { full_name: "عبدالهادي علي", email: "abdelhady.ali@naam-capital.com", password: "Naam@2026!Hady", role: "warehouse_supervisor" },
  { full_name: "فاطمة محمد", email: "fatma.mohamed@naam-capital.com", password: "Naam@2026!Fatma", role: "warehouse_supervisor" },
  // Sales team
  { full_name: "آية كمال", email: "aya.kamal@naam-capital.com", password: "Naam@2026!Aya", role: "sales_moderator" },
  { full_name: "سارة أحمد", email: "sara.ahmed@naam-capital.com", password: "Naam@2026!Sara", role: "sales_moderator" },
  { full_name: "سارة دسوقي", email: "sara.dasouky@naam-capital.com", password: "Naam@2026!Dasouky", role: "sales_moderator" },
  { full_name: "نورا محمد", email: "noura.mohamed@naam-capital.com", password: "Naam@2026!Noura", role: "sales_moderator" },
  // Finance team
  { full_name: "محمد شعلة", email: "mohamed.shaala@naam-capital.com", password: "Naam@2026!Shaala", role: "accountant" },
  { full_name: "محمد خالد", email: "mohamed.khaled@naam-capital.com", password: "Naam@2026!MKhaled", role: "accountant" },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const results: any[] = [];

  for (const emp of employees) {
    try {
      const { data, error } = await supabase.auth.admin.createUser({
        email: emp.email,
        password: emp.password,
        email_confirm: true,
        user_metadata: { full_name: emp.full_name },
      });

      if (error) {
        results.push({ email: emp.email, status: "skipped", reason: error.message });
        continue;
      }

      const uid = data.user!.id;

      // Update role (handle_new_user trigger creates default sales_moderator)
      await supabase.from("user_roles").update({ role: emp.role }).eq("user_id", uid);
      // Ensure profile name is correct
      await supabase.from("profiles").update({ full_name: emp.full_name }).eq("id", uid);

      results.push({ email: emp.email, status: "created", role: emp.role });
    } catch (e: any) {
      results.push({ email: emp.email, status: "error", reason: e.message });
    }
  }

  return new Response(JSON.stringify({ results }, null, 2), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
