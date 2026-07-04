// Temporary explorer: logs in and dumps a Zodex page (links + status columns)
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const ZODEX_BASE = "https://zodex-eg.com/admin-area";

class ZodexClient {
  private cookies = new Map<string, string>();
  private cookieHeader() { return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; "); }
  private capture(res: Response) {
    const anyH = res.headers as any;
    const list: string[] = typeof anyH.getSetCookie === "function" ? anyH.getSetCookie() : (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of list) { const m = line.match(/^\s*([^=;]+)=([^;]*)/); if (m) this.cookies.set(m[1].trim(), m[2].trim()); }
  }
  async login(email: string, password: string) {
    const g = await fetch(`${ZODEX_BASE}/login.php`, { headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual" });
    this.capture(g); await g.text();
    const body = new URLSearchParams({ email, password, location: "", authorize: "1", "remember-me": "1" });
    const p = await fetch(`${ZODEX_BASE}/login.php`, { method: "POST", headers: { "User-Agent": "Mozilla/5.0", "Content-Type": "application/x-www-form-urlencoded", "Cookie": this.cookieHeader() }, body, redirect: "manual" });
    this.capture(p); await p.text();
  }
  async get(path: string): Promise<string> {
    const r = await fetch(`${ZODEX_BASE}${path}`, { headers: { "User-Agent": "Mozilla/5.0", "Cookie": this.cookieHeader() } });
    this.capture(r);
    return await r.text();
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const path = url.searchParams.get("path") || "/index.php";
  const mode = url.searchParams.get("mode") || "links"; // links | raw | tables

  const c = new ZodexClient();
  await c.login(Deno.env.get("ZODEX_USERNAME")!, Deno.env.get("ZODEX_PASSWORD")!);
  const html = await c.get(path);

  if (mode === "raw") {
    return new Response(html.slice(0, 20000), { headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8" } });
  }

  if (mode === "links") {
    // Extract sidebar/menu links
    const links: { href: string; text: string }[] = [];
    const re = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      const href = m[1];
      const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!text) continue;
      if (!/shipment|pickup|showBalance|deferred|delayed|operation|بيك|شحن|مخزن|توصيل|مؤجل|متأخر|قيد/i.test(href + " " + text)) continue;
      links.push({ href, text });
    }
    return new Response(JSON.stringify({ path, len: html.length, count: links.length, links: links.slice(0, 200) }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  if (mode === "tables") {
    // Return a compact summary: for each <table>, its header cells and row count
    const out: any[] = [];
    const tblRe = /<table[\s\S]*?<\/table>/gi;
    let t: RegExpExecArray | null;
    while ((t = tblRe.exec(html)) !== null) {
      const block = t[0];
      const headers = [...block.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/gi)].map(x => x[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
      const rowCount = (block.match(/<tr/gi) || []).length - 1;
      out.push({ headers, rowCount });
    }
    return new Response(JSON.stringify({ path, tables: out }, null, 2), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }

  return new Response("unknown mode", { headers: corsHeaders });
});
