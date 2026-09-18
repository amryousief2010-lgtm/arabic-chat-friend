// Edge Function: zodex-probe
// Debug-only scrape of Zodex shipping-partner pages (headers / sample bill numbers).
// Restricted to verified JWT + ZODEX_REVIEW_ALLOWED_ROLES. Disabled in production
// unless ZODEX_PROBE_ENABLED=true. Not used by the in-app UI.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import {
  createServiceClient,
  isAuthResponse,
  jsonAuthError,
  requireVerifiedUser,
  userHasAnyRole,
  ZODEX_REVIEW_ALLOWED_ROLES,
} from "../_shared/require-user.ts";

const ZODEX_BASE = "https://zodex-eg.com/admin-area";

class C {
  cookies = new Map<string,string>();
  ch(){return [...this.cookies.entries()].map(([k,v])=>`${k}=${v}`).join("; ");}
  cap(r:Response){const l:string[]=(r.headers as any).getSetCookie?.() ?? (r.headers.get("set-cookie")?[r.headers.get("set-cookie")!]:[]);for(const s of l){const m=s.match(/^\s*([^=;]+)=([^;]*)/);if(m)this.cookies.set(m[1].trim(),m[2].trim());}}
  async login(e:string,p:string){const g=await fetch(`${ZODEX_BASE}/login.php`,{headers:{"User-Agent":"Mozilla/5.0"},redirect:"manual"});this.cap(g);await g.text();
    const b=new URLSearchParams({email:e,password:p,location:"",authorize:"1","remember-me":"1"});
    const r=await fetch(`${ZODEX_BASE}/login.php`,{method:"POST",headers:{"User-Agent":"Mozilla/5.0","Content-Type":"application/x-www-form-urlencoded",Cookie:this.ch()},body:b,redirect:"manual"});this.cap(r);await r.text();}
  async get(path:string,params?:Record<string,string|number>){const u=new URL(`${ZODEX_BASE}${path}`);if(params)for(const[k,v]of Object.entries(params))u.searchParams.set(k,String(v));const r=await fetch(u.toString(),{headers:{"User-Agent":"Mozilla/5.0",Cookie:this.ch()}});this.cap(r);return await r.text();}
}

function isProbeDisabledInProduction(): boolean {
  const flag = (Deno.env.get("ZODEX_PROBE_ENABLED") || "").toLowerCase();
  if (flag === "true") return false;
  if (flag === "false") return true;
  const env = (Deno.env.get("ENVIRONMENT") || Deno.env.get("APP_ENV") || "").toLowerCase();
  return env === "production" || env === "prod";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const admin = createServiceClient();
    const verified = await requireVerifiedUser(req, corsHeaders, admin);
    if (isAuthResponse(verified)) return verified;

    const allowed = await userHasAnyRole(admin, verified.user.id, ZODEX_REVIEW_ALLOWED_ROLES);
    if (!allowed) {
      return jsonAuthError(corsHeaders, 403, "Forbidden");
    }

    if (isProbeDisabledInProduction()) {
      return jsonAuthError(corsHeaders, 403, "Forbidden");
    }

    const user = Deno.env.get("ZODEX_USERNAME");
    const pass = Deno.env.get("ZODEX_PASSWORD");
    if (!user || !pass) {
      return new Response(
        JSON.stringify({ error: "Zodex credentials are not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const c = new C();
    await c.login(user, pass);
    const out: Record<string, unknown> = {};
    const bills = (h:string)=>[...new Set((h.match(/ZX\d+/g)||[]))];
    const headers = (h:string)=>{const t=h.match(/<thead[\s\S]*?<\/thead>/i)?.[0]||"";return (t.match(/<th[^>]*>([\s\S]*?)<\/th>/gi)||[]).map(x=>x.replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim()).filter(Boolean);};
    const plain = await c.get("/shippings.php", { items: 50, page: 1 });
    out.plain = { bills: bills(plain).length, headers: headers(plain), sample: bills(plain).slice(0,3) };
    const today = new Date().toISOString().slice(0,10);
    const from = new Date(Date.now()-3*86400000).toISOString().slice(0,10);
    const filtered = await c.get("/shippings.php", { action:"filter", items: 50, page: 1, from, to: today });
    out.filtered = { from, to: today, bills: bills(filtered).length, headers: headers(filtered), sample: bills(filtered).slice(0,3) };
    const wide = await c.get("/shippings.php", { action:"filter", items: 50, page: 1, from: "2026-01-01", to: today });
    out.wide = { bills: bills(wide).length, sample: bills(wide).slice(0,3) };
    const p2 = await c.get("/shippings.php", { action:"filter", items: 50, page: 2, from: "2026-01-01", to: today });
    out.wide_page2 = { bills: bills(p2).length, sample: bills(p2).slice(0,3) };
    out.inputs = [...new Set((plain.match(/<input[^>]*name="[^"]+"/gi)||[]).map(s=>s.match(/name="([^"]+)"/)![1]))];
    out.selects = [...new Set((plain.match(/<select[^>]*name="[^"]+"/gi)||[]).map(s=>s.match(/name="([^"]+)"/)![1]))];
    return new Response(JSON.stringify(out,null,2), { headers: { ...corsHeaders, "Content-Type":"application/json" } });
  } catch (e: any) {
    console.error("[zodex-probe] error:", e?.message || e);
    return new Response(
      JSON.stringify({ error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
