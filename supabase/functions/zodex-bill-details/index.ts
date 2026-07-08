// Edge Function: zodex-bill-details
// Logs into Zodex server-side and returns structured details for a single waybill.
// Used by the ZodexReview screen so reviewers can compare Zodex bill vs local
// order without opening zodex-eg.com manually.

import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { DOMParser, Element } from "https://deno.land/x/deno_dom@v0.1.45/deno-dom-wasm.ts";

const ZODEX_BASE = "https://zodex-eg.com/admin-area";

class ZodexClient {
  private cookies = new Map<string, string>();
  private cookieHeader() {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  private captureCookies(res: Response) {
    const list: string[] = (res.headers as any).getSetCookie?.() ??
      (res.headers.get("set-cookie") ? [res.headers.get("set-cookie")!] : []);
    for (const line of list) {
      const m = line.match(/^\s*([^=;]+)=([^;]*)/);
      if (m) this.cookies.set(m[1].trim(), m[2].trim());
    }
  }
  async login(email: string, password: string) {
    const g = await fetch(`${ZODEX_BASE}/login.php`, {
      headers: { "User-Agent": "Mozilla/5.0" }, redirect: "manual",
    });
    this.captureCookies(g); await g.text();
    const body = new URLSearchParams({
      email, password, location: "", authorize: "1", "remember-me": "1",
    });
    const p = await fetch(`${ZODEX_BASE}/login.php`, {
      method: "POST",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: this.cookieHeader(),
      },
      body, redirect: "manual",
    });
    this.captureCookies(p); await p.text();
    const idx = await this.get("/index.php");
    if (idx.includes('id="email"') && idx.includes('id="password"')) {
      throw new Error("Zodex login failed - still on login page");
    }
  }
  async get(path: string, params?: Record<string, string | number>) {
    const url = new URL(`${ZODEX_BASE}${path}`);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    const r = await fetch(url.toString(), {
      headers: { "User-Agent": "Mozilla/5.0", Cookie: this.cookieHeader() },
    });
    this.captureCookies(r);
    return await r.text();
  }
}

function txt(el: Element | null | undefined): string {
  return (el?.textContent || "").replace(/\s+/g, " ").trim();
}

interface BillDetails {
  bill_no: string;
  receiver_name: string | null;
  phone: string | null;
  phone2: string | null;
  region: string | null;
  sub_region: string | null;
  address: string | null;
  cod_amount: number | null;
  status: string | null;
  shipment_date: string | null;
  sender: string | null;
  moderator_name: string | null;
  task_type: string | null;
  notes: string | null;
  raw_cells: string[];
}

function dedupe(s: string | null): string | null {
  // Zodex renders some cells twice (link text + copy button), e.g. "ZX...ZX..."
  if (!s) return s;
  const half = Math.floor(s.length / 2);
  if (half > 1 && s.length % 2 === 0 && s.slice(0, half) === s.slice(half)) {
    return s.slice(0, half);
  }
  return s;
}

function parseBillRow(html: string, billNo: string): BillDetails | null {
  const doc = new DOMParser().parseFromString(html, "text/html");
  if (!doc) return null;

  const target = billNo.toUpperCase();
  const trs = doc.querySelectorAll("tr") as unknown as Element[];
  for (const tr of trs) {
    const tds = tr.querySelectorAll(":scope > td") as unknown as Element[];
    if (tds.length < 5) continue;
    const cells = Array.from(tds).map((td) => txt(td));
    const hasBill = cells.some((c) => c.toUpperCase().includes(target));
    if (!hasBill) continue;

    // Classify each cell
    const digitsOnly: { idx: number; val: string }[] = [];
    const nameWithPhone: { idx: number; name: string; phone: string }[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const compact = c.replace(/[^\d]/g, "");
      // pure phone cell (only digits/spaces/+ / -)
      if (/^[\d\s+()\-]{10,20}$/.test(c) && /^01\d{9}$/.test(compact)) {
        digitsOnly.push({ idx: i, val: compact });
        continue;
      }
      // "name 01xxxxxxxxx" pattern → moderator + phone
      const m = c.match(/^(.+?)\s+(01\d{9})\s*$/);
      if (m && /[\u0600-\u06FF]/.test(m[1])) {
        nameWithPhone.push({ idx: i, name: m[1].trim(), phone: m[2] });
      }
    }
    const customerPhones = digitsOnly.map((d) => d.val);
    const moderator = nameWithPhone[0]?.name ?? null;

    // COD amount = largest plain number cell
    let cod: number | null = null;
    let codIdx = -1;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (/^\d{2,7}(\.\d+)?$/.test(c)) {
        const n = parseFloat(c);
        if (cod === null || n > cod) { cod = n; codIdx = i; }
      }
    }

    // Status
    let status: string | null = null;
    for (const c of cells) {
      if (c.length > 60) continue;
      if (/طلب بيك أب|بيك اب|جاري التوصيل|تسليم|مرتجع|مؤجل|ملغى|رفض|الغاء|فشل/.test(c)) {
        status = c; break;
      }
    }

    // Date (first ISO-like date)
    let shipment_date: string | null = null;
    for (const c of cells) {
      const m = c.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?:\s*[APap][Mm])?)?/);
      if (m) { shipment_date = m[0]; break; }
    }

    // Arabic-only cells (no digits), keep index for positional heuristics
    const arabicCells: { idx: number; val: string }[] = [];
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      if (c.length < 2 || c.length > 80) continue;
      if (!/[\u0600-\u06FF]/.test(c)) continue;
      if (/\d/.test(c)) continue;
      if (status && c === status) continue;
      arabicCells.push({ idx: i, val: c });
    }
    // Sender = first arabic cell (often "sender company" doubled)
    const sender = dedupe(arabicCells[0]?.val ?? null);
    // Receiver = arabic cell not equal to sender and short-ish
    const receiver =
      arabicCells.find((a) => a.val !== arabicCells[0]?.val && a.val.length <= 40)?.val ?? null;
    // Region = arabic cell that appears just before the COD cell (that's the pattern
    // observed in Zodex layout). Fall back to the last short arabic cell.
    let region: string | null = null;
    if (codIdx > 0) {
      const before = arabicCells.filter((a) => a.idx < codIdx);
      region = before[before.length - 1]?.val ?? null;
    }
    if (!region) {
      const shortArabic = arabicCells.filter((a) => a.val.length <= 20);
      region = shortArabic[shortArabic.length - 1]?.val ?? null;
    }
    // Sub-region / branch: any cell containing "فرع" or the second-to-last short arabic cell
    const sub_region =
      arabicCells.find((a) => /فرع|منطقة/.test(a.val) && a.val !== region)?.val ?? null;

    // Address: long arabic cell with digits (streets often have numbers)
    let address: string | null = null;
    for (const c of cells) {
      if (c.length >= 15 && /[\u0600-\u06FF]/.test(c) && /ش |شارع|متفرع|امام|خلف|بجوار/.test(c)) {
        address = c; break;
      }
    }

    // Task type
    let task_type: string | null = null;
    for (const c of cells) {
      if (/تسليم و تحصيل|توصيل|بيك ?أب|بيك ?اب|استرجاع|تبديل/.test(c) && c.length <= 30) {
        task_type = c; break;
      }
    }

    return {
      bill_no: target,
      receiver_name: dedupe(receiver),
      phone: customerPhones[0] ?? null,
      phone2: customerPhones[1] ?? null,
      region: dedupe(region),
      sub_region: dedupe(sub_region),
      address,
      cod_amount: cod,
      status,
      shipment_date,
      sender,
      moderator_name: moderator,
      task_type,
      notes: null,
      raw_cells: cells,
    };
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const billNo = String(body.bill_no || "").trim().toUpperCase();
    if (!/^ZX\d+$/.test(billNo)) {
      return new Response(
        JSON.stringify({ success: false, error: "bill_no مطلوب بصيغة ZX..." }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const user = Deno.env.get("ZODEX_USERNAME");
    const pass = Deno.env.get("ZODEX_PASSWORD");
    if (!user || !pass) {
      return new Response(
        JSON.stringify({ success: false, error: "بيانات دخول زودكس مش متسجلة على السيرفر" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const client = new ZodexClient();
    await client.login(user, pass);

    // Zodex search page filters by waybill query param
    const html = await client.get("/shippings.php", { waybill: billNo });
    const details = parseBillRow(html, billNo);

    if (!details) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `البوليصة ${billNo} مش موجودة على زودكس (أو الصفحة اتغيرت).`,
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, details }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e: any) {
    console.error("[zodex-bill-details] error:", e?.message || e);
    return new Response(
      JSON.stringify({ success: false, error: String(e?.message || e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
