import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ZODEX_BASE = "https://zodex-eg.com/admin-area";

class ZodexClient {
  private cookies = new Map<string, string>();
  private cookieHeader() { return [...this.cookies.entries()].map(([k,v])=>`${k}=${v}`).join("; "); }
  private captureCookies(res: Response) {
    const anyH = res.headers as any;
    const list: string[] = typeof anyH.getSetCookie === "function" ? anyH.getSetCookie() : [];
    for (const line of list) { const m = line.match(/^\s*([^=;]+)=([^;]*)/); if (m) this.cookies.set(m[1].trim(), m[2].trim()); }
  }
  async login(email: string, password: string) {
    const g = await fetch(`${ZODEX_BASE}/login.php`, { redirect: "manual" });
    this.captureCookies(g); await g.text();
    const p = await fetch(`${ZODEX_BASE}/login.php`, {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded", "Cookie": this.cookieHeader() },
      body: new URLSearchParams({ email, password, location:"", authorize:"1", "remember-me":"1" }),
      redirect: "manual",
    });
    this.captureCookies(p); await p.text();
  }
  async get(url: string) {
    const r = await fetch(url, { headers: { "Cookie": this.cookieHeader() } });
    this.captureCookies(r); return await r.text();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const email = Deno.env.get("ZODEX_EMAIL")!;
  const password = Deno.env.get("ZODEX_PASSWORD")!;
  const client = new ZodexClient();
  await client.login(email, password);
  const html = await client.get(`${ZODEX_BASE}/shippings.php?action=shippings_grouping`);
  // Find slice around نعام العاصمة
  const idx = html.indexOf("نعام");
  const slice = idx >= 0 ? html.slice(Math.max(0, idx - 2000), idx + 3000) : html.slice(0, 5000);
  return new Response(JSON.stringify({ length: html.length, foundAt: idx, slice }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
