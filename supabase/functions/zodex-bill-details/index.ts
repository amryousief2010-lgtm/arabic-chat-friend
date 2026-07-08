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

    // Extract phones (11-digit Egyptian mobile)
    const phones: string[] = [];
    for (const c of cells) {
      const compact = c.replace(/[^\d]/g, "");
      if (/^01\d{9}$/.test(compact) && !phones.includes(compact)) phones.push(compact);
      // some cells contain "name 010..." — capture the digits too
      const m = c.match(/01\d{9}/g);
      if (m) for (const p of m) if (!phones.includes(p)) phones.push(p);
    }

    // COD amount = largest plain number cell
    let cod: number | null = null;
    for (const c of cells) {
      if (/^\d{2,7}(\.\d+)?$/.test(c)) {
        const n = parseFloat(c);
        if (cod === null || n > cod) cod = n;
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

    // Date
    let shipment_date: string | null = null;
    for (const c of cells) {
      const m = c.match(/\d{4}-\d{2}-\d{2}(?:\s+\d{1,2}:\d{2}(?:\s*[APap][Mm])?)?/);
      if (m) { shipment_date = m[0]; break; }
    }

    // Arabic name cells (no digits, 2-40 chars). Collect all candidates.
    const arabicCells = cells.filter((c) =>
      c.length >= 2 && c.length <= 40 &&
      /[\u0600-\u06FF]/.test(c) && !/\d/.test(c) &&
      !(status && c === status),
    );
    // Heuristic: sender is usually the first arabic cell, receiver the second,
    // region the third, sub_region the fourth. Fall back gracefully.
    const sender = arabicCells[0] ?? null;
    const receiver = arabicCells[1] ?? null;
    const region = arabicCells[2] ?? null;
    const sub_region = arabicCells[3] ?? null;

    // Task type (نوع التاسك)
    let task_type: string | null = null;
    for (const c of cells) {
      if (/^(توصيل|بيك ?أب|بيك ?اب|استرجاع|تبديل)$/.test(c)) { task_type = c; break; }
    }

    return {
      bill_no: target,
      receiver_name: receiver,
      phone: phones[0] ?? null,
      phone2: phones[1] ?? null,
      region,
      sub_region,
      address: null,
      cod_amount: cod,
      status,
      shipment_date,
      sender,
      moderator_name: null,
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
