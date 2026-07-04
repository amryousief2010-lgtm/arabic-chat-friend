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
    const g = await fetch(`${ZODEX_BASE}/login.php`, { headers: { "User-Agent":"Mozilla/5.0" }, redirect: "manual" });
    this.captureCookies(g); await g.text();
    const p = await fetch(`${ZODEX_BASE}/login.php`, {
      method: "POST",
      headers: { "User-Agent":"Mozilla/5.0", "Content-Type":"application/x-www-form-urlencoded", "Cookie": this.cookieHeader() },
      body: new URLSearchParams({ email, password, location:"", authorize:"1", "remember-me":"1" }),
      redirect: "manual",
    });
    this.captureCookies(p); await p.text();
    const idx = await this.get("/index.php");
    if (idx.includes('id="email"') && idx.includes('id="password"')) throw new Error("login failed");
  }
  async get(path: string, params?: Record<string,string|number>): Promise<string> {
    const url = new URL(`${ZODEX_BASE}${path}`);
    if (params) for (const [k,v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString(), { headers: { "User-Agent":"Mozilla/5.0", "Cookie": this.cookieHeader() } });
    this.captureCookies(r); return await r.text();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const search = url.searchParams.get("q") || "55811";
  const email = Deno.env.get("ZODEX_EMAIL")!;
  const password = Deno.env.get("ZODEX_PASSWORD")!;
  const client = new ZodexClient();
  await client.login(email, password);
  const html = await client.get(`${ZODEX_BASE}/users.php?action=showBalance&id=215&account_type=shipper`);
  const idx = html.indexOf(search);
  const slice = idx >= 0 ? html.slice(Math.max(0, idx - 1500), idx + 4000) : "not found";
  // Count invoice-like rows (numbers appearing as bold totals)
  const zxCount = (html.match(/ZX\d+/g) || []).length;
  const invoiceNums = [...new Set((html.match(/>(\d{4,6})</g) || []).map(m => m.slice(1,-1)))].slice(0, 30);
  return new Response(JSON.stringify({ length: html.length, foundAt: idx, zxCount, invoiceNumsSample: invoiceNums, slice }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
