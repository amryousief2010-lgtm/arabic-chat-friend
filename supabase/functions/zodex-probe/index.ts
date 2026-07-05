import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const BASE = "https://zodex-eg.com/admin-area";

class Z {
  private c = new Map<string, string>();
  private ch() { return [...this.c].map(([k, v]) => `${k}=${v}`).join("; "); }
  private cap(r: Response) {
    const list: string[] = (r.headers as any).getSetCookie?.() ?? [];
    for (const l of list) { const m = l.match(/^\s*([^=;]+)=([^;]*)/); if (m) this.c.set(m[1].trim(), m[2].trim()); }
  }
  async login(e: string, p: string) {
    const g = await fetch(`${BASE}/login.php`, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual" });
    this.cap(g); await g.text();
    const body = new URLSearchParams({ email: e, password: p, location: "", authorize: "1", "remember-me": "1" });
    const p2 = await fetch(`${BASE}/login.php`, { method: "POST", headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded", Cookie: this.ch() }, body, redirect: "manual" });
    this.cap(p2); await p2.text();
  }
  async get(path: string, params?: Record<string, string | number>) {
    const url = new URL(`${BASE}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString(), { headers: { "User-Agent": "Mozilla/5.0", Cookie: this.ch() } });
    this.cap(r);
    return await r.text();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const u = new URL(req.url);
  const path = u.searchParams.get("path") || "/shippings.php";
  const params: Record<string, string> = {};
  for (const [k, v] of u.searchParams) if (k !== "path") params[k] = v;
  const z = new Z();
  await z.login(Deno.env.get("ZODEX_USERNAME")!, Deno.env.get("ZODEX_PASSWORD")!);
  const html = await z.get(path, params);
  const zx = html.match(/ZX\d+/g) || [];
  const rowRe = /<tr\b[^>]*>[\s\S]*?<\/tr>/g;
  const rowsSample: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) && rowsSample.length < 3) {
    if (/ZX\d+/.test(m[0])) rowsSample.push(m[0]);
  }
  const strip = (s: string) => s.replace(/<[^>]+>/g, " | ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
  return new Response(JSON.stringify({
    len: html.length,
    is_login: html.includes('id="email"') && html.includes('id="password"'),
    zx_count: zx.length,
    zx_unique: [...new Set(zx)].slice(0, 8),
    row_samples: rowsSample.map(strip).map(s => s.slice(0, 2000)),
  }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
});
